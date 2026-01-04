# Manual Testing Guide for Barber Shop App

This guide provides step-by-step instructions to manually test the application using the pre-created demo users.

## 1. Demo Credentials

The following users have been created for you (Password for all: `password123`):

| Role | Email | Name | Context |
| :--- | :--- | :--- | :--- |
| **Admin** (Shop Owner) | `admin@demo.com` | Demo Admin | Manages Shop, Staff, Services |
| **Staff** (Barber) | `staff@demo.com` | Demo Barber | Manages Schedule, View Appointments |
| **Customer** | `customer@demo.com` | Demo Customer | Books Appointments, Pays |

---

## 2. Admin Workflow (Shop Management)

1. **Login:**
    * Go to `/login`.
    * Sign in as **Admin** (`admin@demo.com`).
2. **View Shop:**
    * You should see "Demo Barber Shop" in your dashboard (or list of shops).
    * Click on the shop to manage it.
3. **Manage Services:**
    * Go to the "Services" tab.
    * Verify "Demo Haircut" ($45.00, 30m) exists.
    * **Test:** Create a new service (e.g., "Beard Trim", 15m, $20).
4. **Manage Staff:**
    * Go to the "Staff" tab.
    * Verify "Demo Barber" exists.
    * **Test:** Add a new staff member (requires a new unique email, e.g., `staff2@demo.com`).

## 3. Staff Workflow (Barber)

1. **Login:**
    * Logout and sign in as **Staff** (`staff@demo.com`).
2. **Check Schedule:**
    * Go to your "Schedule" or "Profile" settings.
    * Verify working hours: Mon-Fri, 09:00 - 18:00.
    * **Test:** Change your availability for a specific day (e.g., set Friday to unavailable) or add a break.
3. **View Appointments:**
    * Go to the "Appointments" view.
    * Initially empty. Wait for the customer step below.

## 4. Customer Workflow (Booking)

1. **Login:**
    * Logout and sign in as **Customer** (`customer@demo.com`).
2. **Book Appointment:**
    * Go to the Booking page (or find the shop via public link if implemented, otherwise use dashboard).
    * Select "Demo Barber Shop".
    * Select "Demo Haircut".
    * Select "Demo Barber".
    * Choose a date (e.g., next Monday) and time (e.g., 10:00 AM).
    * Confirm booking.
3. **Verify Booking:**
    * Check your "My Appointments" page.
    * Status should be `PENDING` (or confirmed if auto-confirm is on).
4. **Reschedule (Test the Logic Fix):**
    * Click "Reschedule" on the appointment.
    * Choose a new time (e.g., Tuesday 11:00 AM).
    * Confirm. The time should update.
    * *Try checking invalid times (e.g., weekend or past hours) to see error handling.*

## 5. Verification Loop

1. **Barber Check:**
    * Login as **Staff** again.
    * You should see the new appointment (at the rescheduled time) in your calendar/list.
2. **Admin Check:**
    * Login as **Admin**.
    * You should see analytics updating (e.g., revenue projection, appointment count).

## Troubleshooting

* **Server Errors:** Check the terminal where `npm run dev` is running for backend logs.
* **Data Reset:** If data gets too messy, you can clear the database (`npx prisma migrate reset`) and re-run the seed command: `hurl --test backend/tests/seed_demo_users.hurl`.
