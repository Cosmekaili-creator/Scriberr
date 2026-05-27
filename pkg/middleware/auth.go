package middleware

import (
	"net/http"
	"strings"
	"time"

	"ascribe/internal/auth"
	"ascribe/internal/database"
	"ascribe/internal/models"

	"github.com/gin-gonic/gin"
)

// AuthMiddleware handles both API key and JWT authentication
func AuthMiddleware(authService *auth.AuthService) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Check for API key first
		apiKey := c.GetHeader("X-API-Key")
		if apiKey != "" {
			key, user, ok := validateAPIKey(apiKey)
			if ok {
				c.Set("auth_type", "api_key")
				c.Set("api_key", key.Key)
				c.Set("user_id", key.UserID)
				c.Set("username", user.Username)
				c.Set("role", user.Role)
				c.Next()
				return
			}
		}

		// Check for JWT token
		var token string
		authHeader := c.GetHeader("Authorization")
		if authHeader != "" {
			parts := strings.SplitN(authHeader, " ", 2)
			if len(parts) == 2 && parts[0] == "Bearer" {
				token = parts[1]
			}
		}

		// Fallback to cookie if no header
		if token == "" {
			if cookie, err := c.Cookie("ascribe_access_token"); err == nil {
				token = cookie
			}
		}

		if token == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Missing authentication"})
			c.Abort()
			return
		}

		claims, err := authService.ValidateToken(token)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid token"})
			c.Abort()
			return
		}

		c.Set("auth_type", "jwt")
		c.Set("user_id", claims.UserID)
		c.Set("username", claims.Username)
		c.Set("role", claims.Role)
		c.Next()
	}
}

// validateAPIKey validates an API key, updates last_used, and returns the key + owning user.
func validateAPIKey(key string) (*models.APIKey, *models.User, bool) {
	var apiKey models.APIKey
	if err := database.DB.Where("key = ? AND is_active = ?", key, true).First(&apiKey).Error; err != nil {
		return nil, nil, false
	}

	// Update last used timestamp
	now := time.Now()
	apiKey.LastUsed = &now
	database.DB.Save(&apiKey)

	// Load the owning user to resolve role
	var user models.User
	if err := database.DB.First(&user, apiKey.UserID).Error; err != nil {
		return nil, nil, false
	}

	return &apiKey, &user, true
}

// APIKeyOnlyMiddleware only allows API key authentication
func APIKeyOnlyMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		apiKey := c.GetHeader("X-API-Key")
		if apiKey == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "API key required"})
			c.Abort()
			return
		}

		key, user, ok := validateAPIKey(apiKey)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid API key"})
			c.Abort()
			return
		}

		c.Set("auth_type", "api_key")
		c.Set("api_key", key.Key)
		c.Set("user_id", key.UserID)
		c.Set("username", user.Username)
		c.Set("role", user.Role)
		c.Next()
	}
}

// JWTOnlyMiddleware only allows JWT authentication
func JWTOnlyMiddleware(authService *auth.AuthService) gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Authorization header required"})
			c.Abort()
			return
		}

		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || parts[0] != "Bearer" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid authorization header format"})
			c.Abort()
			return
		}

		token := parts[1]
		claims, err := authService.ValidateToken(token)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid token"})
			c.Abort()
			return
		}

		c.Set("auth_type", "jwt")
		c.Set("user_id", claims.UserID)
		c.Set("username", claims.Username)
		c.Set("role", claims.Role)
		c.Next()
	}
}
