# Barber Shop App - Requirements Questionnaire

Please answer the following questions to help us define the scope and technical details of the application.

## 1. Technical Preferences

- **Backend**: Node.js/express
- **Database**: PostgreSQL
- **Frontend**: react pwa app
- **Hosting**: not yet, let's implement first then we will see

## 2. Multi-tenancy Strategy

- **Isolation**: How should we separate data for different barber shops?
  - *Option A*: Shared Database (all data in one DB with a `tenant_id` column). Simplest to maintain.
- **Identification**: How does the app know which shop the user is accessing?
  - Unique URL/Link for each shop?

## 3. Business Rules & Scheduling

- **Services**: Do services have different durations? (e.g., Haircut 30m, Beard 15m)
- **Booking Flow**:
  - Can a customer book multiple services in one appointment? no, choose only one service
  - Do customers choose a specific barber, or "Any available"? specific or any available
- **Availability**:
  - Do barbers have individual working hours? yes
  - How are breaks/lunch handled? breaks are handled by the barber
- **Cancellations**: What is the policy? free cancellation up to 24h before.

## 4. Roles & Permissions

- **Admin (Owner)**:
  - Can they manage other staff members? yes
  - Can they see financial reports? yes
- **Staff (Barber)**:
  - Can they edit their own schedule? yes
  - Can they book appointments for walk-in customers? yes
- **Customer**:
  - Do they need a profile history of past cuts? yes

## 5. Payments

- **Integration**: Do you want in-app payments? this will not be implemented for the MVP
- **Flow**: Pay upfront, pay deposit, or pay at the shop? pay at the shop

## 6. Notifications

- **Channels**: Email, SMS, Push Notifications? this will not be implemented for the MVP
- **Triggers**: Booking confirmation, Reminder (e.g., 1h before), Cancellation.

## 7. Design & Branding

- **Theme**: Do you have a color palette or style guide? no, let's focus on the UX only with black and white colors (tailwind)
- **Logo**: Do you have assets ready? no

Please fill in or answer these questions in the chat!
