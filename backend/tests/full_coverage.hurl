# Barber Shop API Full Coverage Tests (v6)
# Usage: hurl --test backend/tests/full_coverage.hurl

# ==========================================
# 1. AUTHENTICATION & SETUP
# ==========================================

# 1.1 Register Admin
POST http://localhost:5100/api/auth/register
{
  "email": "admin_test_full_v6@example.com",
  "password": "password123",
  "name": "Admin Full V6",
  "phone": "0000000000",
  "role": "ADMIN"
}
HTTP 201
[Captures]
admin_token: jsonpath "$.token"
admin_id: jsonpath "$.user.id"

# 1.2 Register Customer
POST http://localhost:5100/api/auth/register
{
  "email": "customer_test_full_v6@example.com",
  "password": "password123",
  "name": "Customer Full V6",
  "phone": "1111111111",
  "role": "CUSTOMER"
}
HTTP 201
[Captures]
customer_token: jsonpath "$.token"
customer_id: jsonpath "$.user.id"

# ==========================================
# 2. GLOBAL SERVICES (Admin Only)
# ==========================================

# 2.1 Create Global Service
POST http://localhost:5100/api/global-services
Authorization: Bearer {{admin_token}}
{
  "name": "Global Haircut",
  "description": "Standard global cut",
  "defaultDuration": 45,
  "defaultPrice": 60.00,
  "type": "HAIRCUT"
}
HTTP 201
[Captures]
global_service_id: jsonpath "$.id"

# 2.2 List Global Services
GET http://localhost:5100/api/global-services
Authorization: Bearer {{admin_token}}
HTTP 200
[Asserts]
jsonpath "$" count > 0

# ==========================================
# 3. SHOP MANAGEMENT
# ==========================================

# 3.1 Create Shop
POST http://localhost:5100/api/shops
Authorization: Bearer {{admin_token}}
{
  "name": "Full Test Shop V6",
  "slug": "full-test-shop-v6"
}
HTTP 201
[Captures]
shop_id: jsonpath "$.id"

# 3.2 Get Shops List
GET http://localhost:5100/api/shops
Authorization: Bearer {{admin_token}}
HTTP 200
[Asserts]
jsonpath "$" count > 0

# 3.3 Get Shop Details
GET http://localhost:5100/api/shops/full-test-shop-v6
Authorization: Bearer {{admin_token}}
HTTP 200
[Asserts]
jsonpath "$.name" == "Full Test Shop V6"

# 3.4 Update Shop
PUT http://localhost:5100/api/shops/{{shop_id}}
Authorization: Bearer {{admin_token}}
{
  "name": "Updated Test Shop V6",
  "slug": "updated-test-shop-v6"
}
HTTP 200
[Asserts]
jsonpath "$.name" == "Updated Test Shop V6"

# ==========================================
# 4. STAFF MANAGEMENT
# ==========================================

# 4.1 Create Staff
POST http://localhost:5100/api/shops/staff/create
Authorization: Bearer {{admin_token}}
{
  "shopId": {{shop_id}},
  "name": "Staff Full V6",
  "email": "staff_test_full_v6@example.com",
  "password": "password123",
  "role": "STAFF"
}
HTTP 201
[Captures]
staff_profile_id: jsonpath "$.id"
staff_user_id: jsonpath "$.userId"

# 4.2 Login as Staff
POST http://localhost:5100/api/auth/login
{
  "email": "staff_test_full_v6@example.com",
  "password": "password123"
}
HTTP 200
[Captures]
staff_token: jsonpath "$.token"

# 4.3 Initialize Schedule
# Setting schedule for Monday (1) and Tuesday (2)
POST http://localhost:5100/api/schedule
Authorization: Bearer {{staff_token}}
{
  "shopId": {{shop_id}},
  "schedules": [
    {
      "dayOfWeek": 1,
      "startTime": "09:00",
      "endTime": "18:00",
      "isAvailable": true
    },
    {
      "dayOfWeek": 2,
      "startTime": "09:00",
      "endTime": "18:00",
      "isAvailable": true
    }
  ]
}
HTTP 200

# 4.4 Get Schedule
GET http://localhost:5100/api/schedule?shopId={{shop_id}}
Authorization: Bearer {{staff_token}}
HTTP 200
[Asserts]
jsonpath "$" count >= 2

# ==========================================
# 5. SERVICE MANAGEMENT
# ==========================================

# 5.1 Create Service (Local)
POST http://localhost:5100/api/services
Authorization: Bearer {{admin_token}}
{
  "shopId": {{shop_id}},
  "name": "Local Shave",
  "duration": 20,
  "price": 30.00,
  "description": "Quick shave",
  "type": "BEARD"
}
HTTP 201
[Captures]
service_id: jsonpath "$.id"

# 5.2 Get Services by Shop
GET http://localhost:5100/api/services/shop/{{shop_id}}
Authorization: Bearer {{admin_token}}
HTTP 200
[Asserts]
jsonpath "$" count > 0

# 5.3 Update Service
PUT http://localhost:5100/api/services/{{service_id}}
Authorization: Bearer {{admin_token}}
{
  "name": "Premium Shave",
  "price": 35.00
}
HTTP 200
[Asserts]
jsonpath "$.name" == "Premium Shave"
jsonpath "$.price" == "35"

# ==========================================
# 6. APPOINTMENTS
# ==========================================

# 6.1 Check Availability
# Checking availability for a future Monday (e.g., 2026-06-22)
GET http://localhost:5100/api/appointments/availability?barberId={{staff_profile_id}}&serviceId={{service_id}}&date=2026-06-22
Authorization: Bearer {{customer_token}}
HTTP 200
[Asserts]
jsonpath "$" count > 0

# 6.2 Create Appointment
POST http://localhost:5100/api/appointments
Authorization: Bearer {{customer_token}}
{
  "shopId": {{shop_id}},
  "barberId": {{staff_profile_id}},
  "serviceId": {{service_id}},
  "startTime": "2026-06-22T10:00:00.000Z",
  "paymentMethod": "CASH"
}
HTTP 201
[Captures]
appointment_id: jsonpath "$.id"

# 6.3 Reschedule Appointment
# Moving to 2026-06-23 (Tuesday) same time.
PATCH http://localhost:5100/api/appointments/{{appointment_id}}/reschedule
Authorization: Bearer {{customer_token}}
{
  "newStartTime": "2026-06-23T10:00:00.000Z"
}
HTTP 200
[Asserts]
jsonpath "$.startTime" contains "2026-06-23"

# ==========================================
# 7. PAYMENTS check
# ==========================================

# 7.1 Create Checkout Session
POST http://localhost:5100/api/payment/create-checkout-session
Authorization: Bearer {{customer_token}}
{
  "appointmentId": {{appointment_id}}
}
HTTP 200
[Captures]
payment_url: jsonpath "$.url"

# 7.2 Create Subscription Session
POST http://localhost:5100/api/payment/create-subscription-session
Authorization: Bearer {{customer_token}}
HTTP 200
[Captures]
sub_url: jsonpath "$.url"

# 7.3 Get Subscription Status
GET http://localhost:5100/api/payment/subscription-status
Authorization: Bearer {{customer_token}}
HTTP 200

# ==========================================
# 8. ANALYTICS (Smoke Test)
# ==========================================

# 8.1 Popular Barbers
GET http://localhost:5100/api/analytics/popular-barbers
Authorization: Bearer {{admin_token}}
HTTP 200

# 8.2 Peak Hours
GET http://localhost:5100/api/analytics/peak-hours
Authorization: Bearer {{admin_token}}
HTTP 200

# 8.3 Peak Days
GET http://localhost:5100/api/analytics/peak-days
Authorization: Bearer {{admin_token}}
HTTP 200

# 8.4 Revenue
GET http://localhost:5100/api/analytics/revenue
Authorization: Bearer {{admin_token}}
HTTP 200

# 8.5 Status Stats
GET http://localhost:5100/api/analytics/status
Authorization: Bearer {{admin_token}}
HTTP 200

# 8.6 Retention
GET http://localhost:5100/api/analytics/retention
Authorization: Bearer {{admin_token}}
HTTP 200

# ==========================================
# 9. ASSIGN GLOBAL SERVICES
# ==========================================

# 9.1 Assign Service to Shop
POST http://localhost:5100/api/global-services/assign
Authorization: Bearer {{admin_token}}
{
  "globalServiceId": {{global_service_id}},
  "shopId": {{shop_id}}
}
HTTP 201

# ==========================================
# 10. CLEANUP (Optional)
# ==========================================

# Delete Service
DELETE http://localhost:5100/api/services/{{service_id}}
Authorization: Bearer {{admin_token}}
HTTP 200

# Delete Shop
DELETE http://localhost:5100/api/shops/{{shop_id}}
Authorization: Bearer {{admin_token}}
HTTP 200
