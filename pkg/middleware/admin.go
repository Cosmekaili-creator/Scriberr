package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// RequireAdmin must run AFTER AuthMiddleware (reads "role" from context).
func RequireAdmin() gin.HandlerFunc {
	return func(c *gin.Context) {
		role, _ := c.Get("role")
		if r, _ := role.(string); r != "admin" {
			c.JSON(http.StatusForbidden, gin.H{"error": "Admin access required"})
			c.Abort()
			return
		}
		c.Next()
	}
}
