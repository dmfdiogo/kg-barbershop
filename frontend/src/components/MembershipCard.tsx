import React from 'react';

interface MembershipCardProps {
    status: string;
    creditsHaircut: number;
    creditsBeard: number;
    currentPeriodEnd?: string;
    onUseBenefit?: () => void; // For testing/manual usage
}

const MembershipCard: React.FC<MembershipCardProps> = ({ status, creditsHaircut, creditsBeard, currentPeriodEnd }) => {
    const isActive = status === 'active';

    return (
        <div className={`rounded-xl p-6 text-white shadow-xl relative overflow-hidden transition-all border border-gray-800 ${isActive ? 'bg-gradient-to-br from-gray-900 to-black border-primary/50' : 'bg-dark-card'}`}>
            {/* Background Pattern */}
            <div className={`absolute top-0 right-0 -mr-10 -mt-10 w-40 h-40 rounded-full opacity-10 blur-xl ${isActive ? 'bg-primary' : 'bg-gray-600'}`}></div>
            <div className={`absolute bottom-0 left-0 -ml-10 -mb-10 w-40 h-40 rounded-full opacity-10 blur-xl ${isActive ? 'bg-primary' : 'bg-gray-600'}`}></div>

            <div className="relative z-10">
                <div className="flex justify-between items-start mb-8">
                    <div>
                        <h3 className={`text-lg font-bold tracking-wider uppercase ${isActive ? 'text-primary' : 'text-text-secondary'}`}>VIP Member</h3>
                        <p className="text-xs text-text-muted">Monthly Subscription</p>
                    </div>
                    <div className={`px-3 py-1 rounded-full text-xs font-bold ${isActive ? 'bg-primary text-black' : 'bg-gray-800 text-gray-400'}`}>
                        {status.toUpperCase()}
                    </div>
                </div>

                <div className="space-y-4 mb-8">
                    <div className="flex justify-between items-center bg-white/10 p-3 rounded-lg">
                        <div className="flex items-center">
                            <i className="ri-scissors-cut-fill text-2xl mr-3 text-primary"></i>
                            <div>
                                <p className="text-sm font-medium opacity-90">Haircuts</p>
                                <p className="text-xs opacity-60">Remaining</p>
                            </div>
                        </div>
                        <div className="text-2xl font-bold">{creditsHaircut} <span className="text-sm font-normal opacity-60">/ 2</span></div>
                    </div>

                    <div className="flex justify-between items-center bg-white/10 p-3 rounded-lg">
                        <div className="flex items-center">
                            <i className="ri-user-smile-fill text-2xl mr-3 text-primary"></i>
                            <div>
                                <p className="text-sm font-medium opacity-90">Beard Trims</p>
                                <p className="text-xs opacity-60">Remaining</p>
                            </div>
                        </div>
                        <div className="text-2xl font-bold">{creditsBeard} <span className="text-sm font-normal opacity-60">/ 1</span></div>
                    </div>
                </div>

                <div className="flex justify-between items-end">
                    <div>
                        <p className="text-xs opacity-60 mb-1">Renews On</p>
                        <p className="font-mono text-sm">{currentPeriodEnd ? new Date(currentPeriodEnd).toLocaleDateString() : 'N/A'}</p>
                    </div>
                    {/* Optional: Add a "Use" button for testing if requested, but usually this is automatic via booking */}
                </div>
            </div>
        </div>
    );
};

export default MembershipCard;
