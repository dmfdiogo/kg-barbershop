# Barber Shop Demo Data Seeding
# Usage: hurl --test backend/tests/seed_demo_users.hurl

# ==========================================
# 1. CREATE USERS
# ==========================================

# 1.1 Admin User
POST http://localhost:5100/api/auth/register
{
  "email": "admin@demo.com",
  "password": "password123",
  "name": "Demo Admin",
  "phone": "999999999",
  "role": "ADMIN"
}
HTTP 201
[Captures]
admin_token: jsonpath "$.token"
admin_id: jsonpath "$.user.id"

# 1.2 Customer User
POST http://localhost:5100/api/auth/register
{
  "email": "customer@demo.com",
  "password": "password123",
  "name": "Demo Customer",
  "phone": "888888888",
  "role": "CUSTOMER"
}
HTTP 201
[Captures]
customer_token: jsonpath "$.token"
customer_id: jsonpath "$.user.id"

# 1.3 Staff User (Standard Account first)
# Note: Staff needs to be created via shop usually, but we can register then assign, or use 'createStaffUser' endpoint.
# Let's simple register here to have the account, but we'll create a PROPER staff profile via admin below.
# Actually, the best flow is Admin creates Staff.
# So we skip direct registration for staff and let Admin do it.

# ==========================================
# 2. SETUP SHOP & SERVICE (by Admin)
# ==========================================

# 2.1 Create Shop
POST http://localhost:5100/api/shops
Authorization: Bearer {{admin_token}}
{
  "name": "Demo Barber Shop",
  "slug": "demo-barber-shop"
}
HTTP 201
[Captures]
shop_id: jsonpath "$.id"

# 2.2 Create Service
POST http://localhost:5100/api/services
Authorization: Bearer {{admin_token}}
{
  "shopId": "{{shop_id}}",
  "name": "Demo Haircut",
  "duration": 30,
  "price": 45.00,
  "description": "A fresh cut for testing",
  "type": "HAIRCUT"
}
HTTP 201
[Captures]
service_id: jsonpath "$.id"

# ==========================================
# 3. SETUP STAFF MEMBER (by Admin)
# ==========================================

# 3.1 Create Staff User & Profile
POST http://localhost:5100/api/shops/staff/create
Authorization: Bearer {{admin_token}}
{
  "shopId": {{shop_id}},
  "name": "Demo Barber",
  "email": "staff@demo.com",
  "password": "password123",
  "role": "STAFF"
}
HTTP 201
[Captures]
staff_profile_id: jsonpath "$.id"
staff_user_id: jsonpath "$.userId"

# 3.2 Login as Staff (to get token for schedule)
POST http://localhost:5100/api/auth/login
{
  "email": "staff@demo.com",
  "password": "password123"
}
HTTP 200
[Captures]
staff_token: jsonpath "$.token"

# 3.3 Initialize Schedule (Mon-Fri 09:00-18:00)
POST http://localhost:5100/api/schedule
Authorization: Bearer {{staff_token}}
{
  "shopId": {{shop_id}},
  "schedules": [
    { "dayOfWeek": 1, "startTime": "09:00", "endTime": "18:00", "isAvailable": true },
    { "dayOfWeek": 2, "startTime": "09:00", "endTime": "18:00", "isAvailable": true },
    { "dayOfWeek": 3, "startTime": "09:00", "endTime": "18:00", "isAvailable": true },
    { "dayOfWeek": 4, "startTime": "09:00", "endTime": "18:00", "isAvailable": true },
    { "dayOfWeek": 5, "startTime": "09:00", "endTime": "18:00", "isAvailable": true }
  ]
}
HTTP 200

# ==========================================
# 4. PRE-CREATE APPOINTMENT (Optional)
# ==========================================

# 4.1 Create one appointment for next Monday
# Calculate date for next Monday? Hurl doesn't do dynamic dates easily.
# We'll skip pre-creating appointment to let the user do it manually.
