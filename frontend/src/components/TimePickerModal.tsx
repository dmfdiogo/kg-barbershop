import React from 'react';
import { DESIGN } from '../theme/design';
import { formatTime } from '../utils/date';

interface TimePickerModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (time: string) => void;
    slots: string[];
    selectedSlot: string | null;
}

const TimePickerModal: React.FC<TimePickerModalProps> = ({ isOpen, onClose, onSelect, slots, selectedSlot }) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[100] backdrop-blur-sm p-4">
            <div
                className={`${DESIGN.card.base} w-full max-w-md max-h-[80vh] flex flex-col animate-slide-up sm:animate-fade-in overflow-hidden`}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="p-4 border-b border-neutral-800 flex justify-between items-center sticky top-0 bg-dark-card z-10">
                    <h3 className={DESIGN.text.subHeader}>Select Time</h3>
                    <button onClick={onClose} className="text-text-secondary hover:text-white p-2">
                        <i className="ri-close-line text-2xl"></i>
                    </button>
                </div>

                <div className="p-4 overflow-y-auto">
                    {slots.length === 0 ? (
                        <div className="text-center py-8 text-text-muted">
                            <i className="ri-time-line text-4xl mb-2 block opacity-50"></i>
                            <p>No available slots for this date.</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                            {slots.map((slot) => (
                                <button
                                    key={slot}
                                    onClick={() => {
                                        onSelect(slot);
                                        onClose();
                                    }}
                                    className={`py-3 px-2 rounded-lg text-sm font-medium transition-all ${selectedSlot === slot
                                        ? 'bg-primary text-black font-bold shadow-lg shadow-primary/20'
                                        : 'bg-dark-input text-text-secondary hover:bg-gray-700 hover:text-white'
                                        }`}
                                >
                                    {formatTime(slot)}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default TimePickerModal;
