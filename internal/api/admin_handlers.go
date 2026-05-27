package api

import (
	"net/http"
	"strconv"
	"strings"

	"ascribe/internal/auth"
	"ascribe/internal/models"

	"github.com/gin-gonic/gin"
)

// AdminUserResponse is the user object returned by admin endpoints
type AdminUserResponse struct {
	ID       uint    `json:"id"`
	Username string  `json:"username"`
	Role     string  `json:"role"`
	FullName *string `json:"full_name,omitempty"`
	Email    *string `json:"email,omitempty"`
	IsActive bool    `json:"is_active"`
}

func adminUserResponse(u *models.User) AdminUserResponse {
	return AdminUserResponse{
		ID:       u.ID,
		Username: u.Username,
		Role:     u.Role,
		FullName: u.FullName,
		Email:    u.Email,
		IsActive: u.IsActive,
	}
}

// AdminListUsers returns all users
// @Summary List all users (admin)
// @Tags admin
// @Produce json
// @Success 200 {array} AdminUserResponse
// @Security ApiKeyAuth
// @Security BearerAuth
// @Router /api/v1/admin/users [get]
func (h *Handler) AdminListUsers(c *gin.Context) {
	users, err := h.userRepo.ListAll(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to list users"})
		return
	}
	resp := make([]AdminUserResponse, len(users))
	for i := range users {
		resp[i] = adminUserResponse(&users[i])
	}
	c.JSON(http.StatusOK, resp)
}

// AdminCreateUserRequest is the payload for admin-created users
type AdminCreateUserRequest struct {
	Username string  `json:"username" binding:"required,min=2,max=50"`
	Password string  `json:"password" binding:"required,min=8"`
	Role     string  `json:"role" binding:"required,oneof=admin user"`
	FullName *string `json:"full_name,omitempty"`
	Email    *string `json:"email,omitempty"`
}

// AdminCreateUser creates a new user
// @Summary Create user (admin)
// @Tags admin
// @Accept json
// @Produce json
// @Param request body AdminCreateUserRequest true "User payload"
// @Success 201 {object} AdminUserResponse
// @Security ApiKeyAuth
// @Security BearerAuth
// @Router /api/v1/admin/users [post]
func (h *Handler) AdminCreateUser(c *gin.Context) {
	var req AdminCreateUserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	hashed, err := auth.HashPassword(req.Password)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to hash password"})
		return
	}

	user := &models.User{
		Username: req.Username,
		Password: hashed,
		Role:     req.Role,
		FullName: req.FullName,
		Email:    req.Email,
		IsActive: true,
	}
	if err := h.userRepo.Create(c.Request.Context(), user); err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			c.JSON(http.StatusConflict, gin.H{"error": "Username already exists"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create user"})
		}
		return
	}
	// Seed an empty usage row so the user appears in usage reports immediately
	if h.usageRepo != nil {
		_ = h.usageRepo.Upsert(c.Request.Context(), user.ID, 0, 0, 0)
	}
	c.JSON(http.StatusCreated, adminUserResponse(user))
}

// AdminGetUser returns a single user
// @Summary Get user (admin)
// @Tags admin
// @Produce json
// @Param id path int true "User ID"
// @Success 200 {object} AdminUserResponse
// @Security ApiKeyAuth
// @Security BearerAuth
// @Router /api/v1/admin/users/{id} [get]
func (h *Handler) AdminGetUser(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}
	user, err := h.userRepo.FindByID(c.Request.Context(), uint(id))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}
	c.JSON(http.StatusOK, adminUserResponse(user))
}

// AdminUpdateUserRequest is the payload for updating a user
type AdminUpdateUserRequest struct {
	Role     string  `json:"role" binding:"omitempty,oneof=admin user"`
	FullName *string `json:"full_name,omitempty"`
	Email    *string `json:"email,omitempty"`
	IsActive *bool   `json:"is_active,omitempty"`
}

// AdminUpdateUser updates a user's metadata
// @Summary Update user (admin)
// @Tags admin
// @Accept json
// @Produce json
// @Param id path int true "User ID"
// @Param request body AdminUpdateUserRequest true "Update payload"
// @Success 200 {object} AdminUserResponse
// @Security ApiKeyAuth
// @Security BearerAuth
// @Router /api/v1/admin/users/{id} [put]
func (h *Handler) AdminUpdateUser(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}
	user, err := h.userRepo.FindByID(c.Request.Context(), uint(id))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	var req AdminUpdateUserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Role != "" {
		// Guard against demoting the last admin
		if req.Role == "user" && user.Role == "admin" {
			adminCount, err := h.userRepo.CountAdmins(c.Request.Context())
			if err != nil || adminCount <= 1 {
				c.JSON(http.StatusBadRequest, gin.H{"error": "Cannot demote the last admin"})
				return
			}
		}
		user.Role = req.Role
	}
	if req.FullName != nil {
		user.FullName = req.FullName
	}
	if req.Email != nil {
		user.Email = req.Email
	}
	if req.IsActive != nil {
		user.IsActive = *req.IsActive
	}

	if err := h.userRepo.Update(c.Request.Context(), user); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update user"})
		return
	}
	c.JSON(http.StatusOK, adminUserResponse(user))
}

// AdminDisableUser deactivates a user account
// @Summary Disable user (admin)
// @Tags admin
// @Produce json
// @Param id path int true "User ID"
// @Success 200 {object} AdminUserResponse
// @Security ApiKeyAuth
// @Security BearerAuth
// @Router /api/v1/admin/users/{id}/disable [post]
func (h *Handler) AdminDisableUser(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}
	callerID, _ := h.currentUserID(c)
	if uint(id) == callerID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Cannot disable your own account"})
		return
	}
	target, err := h.userRepo.FindByID(c.Request.Context(), uint(id))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}
	// Guard: cannot disable the last active admin
	if target.Role == "admin" {
		adminCount, err := h.userRepo.CountAdmins(c.Request.Context())
		if err != nil || adminCount <= 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Cannot disable the last admin"})
			return
		}
	}
	if err := h.userRepo.SetActive(c.Request.Context(), uint(id), false); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to disable user"})
		return
	}
	// Invalidate all existing sessions immediately
	_ = h.refreshTokenRepo.RevokeByUserID(c.Request.Context(), uint(id))
	target.IsActive = false
	c.JSON(http.StatusOK, adminUserResponse(target))
}

// AdminEnableUser reactivates a user account
// @Summary Enable user (admin)
// @Tags admin
// @Produce json
// @Param id path int true "User ID"
// @Success 200 {object} AdminUserResponse
// @Security ApiKeyAuth
// @Security BearerAuth
// @Router /api/v1/admin/users/{id}/enable [post]
func (h *Handler) AdminEnableUser(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}
	if err := h.userRepo.SetActive(c.Request.Context(), uint(id), true); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to enable user"})
		return
	}
	user, _ := h.userRepo.FindByID(c.Request.Context(), uint(id))
	if user == nil {
		c.JSON(http.StatusOK, gin.H{"status": "enabled"})
		return
	}
	c.JSON(http.StatusOK, adminUserResponse(user))
}

// AdminResetPasswordRequest carries the new password
type AdminResetPasswordRequest struct {
	Password string `json:"password" binding:"required,min=8"`
}

// AdminResetPassword sets a new password for any user
// @Summary Reset user password (admin)
// @Tags admin
// @Accept json
// @Produce json
// @Param id path int true "User ID"
// @Param request body AdminResetPasswordRequest true "New password"
// @Success 200 {object} map[string]string
// @Security ApiKeyAuth
// @Security BearerAuth
// @Router /api/v1/admin/users/{id}/reset-password [post]
func (h *Handler) AdminResetPassword(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}
	var req AdminResetPasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	user, err := h.userRepo.FindByID(c.Request.Context(), uint(id))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	hashed, err := auth.HashPassword(req.Password)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to hash password"})
		return
	}
	user.Password = hashed
	if err := h.userRepo.Update(c.Request.Context(), user); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update password"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "password updated"})
}
