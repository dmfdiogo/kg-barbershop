# Barber Shop API Integration Tests (v5)
# Usage: hurl --test backend/tests/integration.hurl

# 1. Register a new Customer
POST http://localhost:5100/api/auth/register
{
  "email": "customer_test_v5@example.com",
  "password": "password123",
  "name": "Test Customer V5",
  "phone": "1234567890",
  "role": "CUSTOMER"
}
HTTP 201
[Captures]
customer_token: jsonpath "$.token"
customer_id: jsonpath "$.user.id"

# 2. Register a new Shop Owner (Admin)
POST http://localhost:5100/api/auth/register
{
  "email": "owner_test_v5@example.com",
  "password": "password123",
  "name": "Test Owner V5",
  "phone": "0987654321",
  "role": "ADMIN"
}
HTTP 201
[Captures]
owner_token: jsonpath "$.token"
owner_id: jsonpath "$.user.id"

# 3. Create a Shop (as Owner)
# Slug must be unique too
POST http://localhost:5100/api/shops
Authorization: Bearer {{owner_token}}
{
  "name": "Test Barber Shop V5",
  "slug": "test-barber-shop-v5"
}
HTTP 201
[Captures]
shop_id: jsonpath "$.id"

# 4. Create a Service (as Owner)
POST http://localhost:5100/api/services
Authorization: Bearer {{owner_token}}
{
  "shopId": "{{shop_id}}",
  "name": "Classic Haircut",
  "duration": 30,
  "price": 50.00,
  "description": "A classic haircut",
  "type": "HAIRCUT"
}
HTTP 201
[Captures]
service_id: jsonpath "$.id"

# 5. Create a Staff Member (as Owner)
# Email must be unique
POST http://localhost:5100/api/shops/staff/create
Authorization: Bearer {{owner_token}}
{
  "shopId": {{shop_id}},
  "name": "Test Barber V5",
  "email": "barber_test_v5@example.com",
  "password": "password123",
  "role": "STAFF"
}
HTTP 201
[Captures]
barber_profile_id: jsonpath "$.id"
barber_user_id: jsonpath "$.userId"

# 6a. Login as Staff
POST http://localhost:5100/api/auth/login
{
  "email": "barber_test_v5@example.com",
  "password": "password123"
}
HTTP 200
[Captures]
staff_token: jsonpath "$.token"

# 6b. Initialize Schedule for Barber (as Staff)
# Payload must wrap in "schedules" array
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
    }
  ]
}
HTTP 200

# 7. Create Appointment (as Customer)
# Booking for 6 months ahead (July 20, 2026 is a Monday)
POST http://localhost:5100/api/appointments
Authorization: Bearer {{customer_token}}
{
  "shopId": {{shop_id}},
  "barberId": {{barber_profile_id}},
  "serviceId": {{service_id}},
  "startTime": "2026-07-20T10:00:00.000Z",
  "paymentMethod": "CASH"
}
HTTP 201
[Captures]
appointment_id: jsonpath "$.id"

# 8. Get Appointments (as Customer)
GET http://localhost:5100/api/appointments
Authorization: Bearer {{customer_token}}
HTTP 200
[Asserts]
jsonpath "$" count > 0

# 9. Update Appointment Status
PATCH http://localhost:5100/api/appointments/{{appointment_id}}/status
Authorization: Bearer {{customer_token}}
{
  "status": "CANCELLED"
}
HTTP 200
[Asserts]
jsonpath "$.status" == "CANCELLED"
