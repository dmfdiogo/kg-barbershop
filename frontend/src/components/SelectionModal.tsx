import React from 'react';


interface SelectionModalProps<T> {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    items: T[];
    onSelect: (item: T) => void;
    renderItem: (item: T) => React.ReactNode;
    keyExtractor: (item: T) => string | number;
}

function SelectionModal<T>({
    isOpen,
    onClose,
    title,
    items,
    onSelect,
    renderItem,
    keyExtractor
}: SelectionModalProps<T>) {
    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 bg-black/60 flex justify-center items-center z-50 backdrop-blur-sm p-4 animate-fade-in-up"
            onClick={onClose}
        >
            <div
                className="bg-dark-card rounded-xl w-full max-w-md shadow-2xl border border-amber-400/10 flex flex-col max-h-[80vh]"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="relative p-4 border-b border-amber-400/10 flex justify-between items-center">
                    <div className="w-8"></div>
                    <h3 className="text-xl font-bold text-white absolute left-1/2 -translate-x-1/2">{title}</h3>
                    <button onClick={onClose} className="text-text-secondary hover:text-white z-10">
                        <i className="ri-close-line text-2xl"></i>
                    </button>
                </div>

                <div className="overflow-y-auto p-4 space-y-3">
                    {items.length === 0 ? (
                        <p className="text-text-muted text-center py-4">No items available.</p>
                    ) : (
                        items.map((item) => (
                            <div
                                key={keyExtractor(item)}
                                onClick={() => {
                                    onSelect(item);
                                    onClose();
                                }}
                                className="cursor-pointer"
                            >
                                {renderItem(item)}
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}

export default SelectionModal;
