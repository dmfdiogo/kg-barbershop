import React, { useState } from 'react';
import dayjs from 'dayjs';


interface DatePickerModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (date: string) => void;
    selectedDate?: string;
}

const DatePickerModal: React.FC<DatePickerModalProps> = ({ isOpen, onClose, onSelect, selectedDate }) => {
    const [currentMonth, setCurrentMonth] = useState(dayjs());

    if (!isOpen) return null;

    const daysInMonth = currentMonth.daysInMonth();
    const startOfMonth = currentMonth.startOf('month').day(); // 0 (Sunday) to 6 (Saturday)
    const today = dayjs();

    const handlePrevMonth = () => setCurrentMonth(currentMonth.subtract(1, 'month'));
    const handleNextMonth = () => setCurrentMonth(currentMonth.add(1, 'month'));

    const handleDateClick = (day: number) => {
        const date = currentMonth.date(day);
        // Prevent selecting past dates
        if (date.isBefore(today, 'day')) return;

        onSelect(date.format('YYYY-MM-DD'));
        onClose();
    };

    const renderCalendarDays = () => {
        const days = [];

        // Empty slots for days before start of month
        for (let i = 0; i < startOfMonth; i++) {
            days.push(<div key={`empty-${i}`} className="h-10 w-10"></div>);
        }

        // Days of the month
        for (let i = 1; i <= daysInMonth; i++) {
            const date = currentMonth.date(i);
            const isToday = date.isSame(today, 'day');
            const isSelected = selectedDate && date.isSame(dayjs(selectedDate), 'day');
            const isPast = date.isBefore(today, 'day');

            days.push(
                <button
                    key={i}
                    onClick={() => handleDateClick(i)}
                    disabled={isPast}
                    className={`h-10 w-10 rounded-full flex items-center justify-center text-sm font-medium transition-colors
                        ${isSelected ? 'bg-primary text-black font-bold' : ''}
                        ${!isSelected && !isPast ? 'text-white hover:bg-gray-700' : ''}
                        ${isPast ? 'text-gray-600 cursor-not-allowed' : ''}
                        ${isToday && !isSelected ? 'border border-primary text-primary' : ''}
                    `}
                >
                    {i}
                </button>
            );
        }

        return days;
    };

    return (
        <div
            className="fixed inset-0 bg-black/60 flex justify-center items-center z-50 backdrop-blur-sm p-4 animate-fade-in-up"
            onClick={onClose}
        >
            <div
                className="bg-dark-card rounded-xl shadow-2xl w-full max-w-md border border-amber-400/10 overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                {/* Header */}
                <div className="relative flex justify-between items-center mb-4 border-b border-amber-400/10 -mx-4 -mt-4 p-4">
                    <button onClick={handlePrevMonth} className="text-white hover:bg-gray-800 rounded-full p-1 z-10">
                        <i className="ri-arrow-left-s-line text-xl"></i>
                    </button>
                    <h3 className="text-lg font-bold text-white absolute left-1/2 -translate-x-1/2">
                        {currentMonth.format('MMMM YYYY')}
                    </h3>
                    <button onClick={handleNextMonth} className="text-white hover:bg-gray-800 rounded-full p-1 z-10">
                        <i className="ri-arrow-right-s-line text-xl"></i>
                    </button>
                </div>

                {/* Days of Week */}
                <div className="grid grid-cols-7 gap-1 mb-2 text-center">
                    {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => (
                        <div key={index} className="text-text-muted text-xs font-bold h-10 flex items-center justify-center">
                            {day}
                        </div>
                    ))}
                </div>

                {/* Calendar Grid */}
                <div className="grid grid-cols-7 gap-1 place-items-center">
                    {renderCalendarDays()}
                </div>

                <div className="mt-4 flex justify-end">
                    <button
                        onClick={onClose}
                        className="text-text-secondary hover:text-white text-sm px-3 py-1"
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
};

export default DatePickerModal;
