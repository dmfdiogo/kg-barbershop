import React from 'react';
import { Calendar, momentLocalizer } from 'react-big-calendar';
import moment from 'moment';
import 'react-big-calendar/lib/css/react-big-calendar.css';

const localizer = momentLocalizer(moment);

interface CalendarViewProps {
    appointments: any[];
    onSelectEvent: (event: any) => void;
}

const CalendarView: React.FC<CalendarViewProps> = ({ appointments, onSelectEvent }) => {
    // Transform appointments to calendar events
    const events = appointments.map(appt => {
        const start = new Date(appt.startTime);
        const end = new Date(start.getTime() + (appt.service?.duration || 30) * 60000);

        return {
            id: appt.id,
            title: `${appt.customer.name} - ${appt.service.name}`,
            start,
            end,
            resource: appt,
            status: appt.status
        };
    });

    const eventStyleGetter = (event: any) => {
        let backgroundColor = '#3174ad';
        if (event.status === 'CONFIRMED') backgroundColor = '#10B981'; // Green
        if (event.status === 'PENDING') backgroundColor = '#F59E0B'; // Yellow
        if (event.status === 'CANCELLED') backgroundColor = '#EF4444'; // Red

        return {
            style: {
                backgroundColor,
                borderRadius: '5px',
                opacity: 0.8,
                color: 'white',
                border: '0px',
                display: 'block'
            }
        };
    };

    return (
        <div className="h-[600px] bg-dark-card p-4 rounded-xl shadow-lg border border-gray-800 text-gray-900">
            <Calendar
                localizer={localizer}
                events={events}
                startAccessor="start"
                endAccessor="end"
                style={{ height: '100%' }}
                onSelectEvent={(event) => onSelectEvent(event.resource)}
                eventPropGetter={eventStyleGetter}
                defaultView="week"
                views={['month', 'week', 'day']}
                step={15}
                timeslots={4}
                className="bg-white rounded-lg p-2" // Keep calendar white for readability for now, or customize heavily later
            />
        </div>
    );
};

export default CalendarView;
