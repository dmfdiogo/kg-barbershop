import React from 'react';

interface MembershipCardProps {
    status: string;
    creditsHaircut: number;
    creditsBeard: number;
    currentPeriodEnd?: string;
    onUseBenefit?: () => void; // For testing/manual usage
}

const MembershipCard: React.FC<MembershipCardProps> = ({ status, creditsHaircut, creditsBeard, currentPeriodEnd }) => {
    const isActive = status === 'active' || status === 'canceled_at_period_end';

    // Calculate percentages for progress bars
    const haircutProgress = (creditsHaircut / 2) * 100;
    const beardProgress = (creditsBeard / 1) * 100;

    return (
        <div className={`relative w-full max-w-md mx-auto rounded-2xl overflow-hidden transition-all duration-300 ${isActive ? 'shadow-2xl shadow-primary/10' : 'grayscale opacity-80'}`}>
            {/* Card Background with Gradient and Texture */}
            <div className="absolute inset-0 bg-gradient-to-br from-[#1a1a1a] to-[#0a0a0a] z-0"></div>
            <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-5 z-0"></div>

            {/* Gold Border/Glow Effect */}
            <div className={`absolute inset-0 border-2 rounded-2xl z-10 pointer-events-none ${isActive ? 'border-primary/30' : 'border-amber-500'}`}></div>

            {/* Content */}
            <div className="relative z-20 p-6 flex flex-col h-full">
                {/* Header */}
                <div className="flex justify-between items-start mb-8">
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <i className="ri-vip-crown-2-fill text-primary text-xl"></i>
                            <h3 className="text-xl font-bold text-white tracking-wide uppercase">Assinatura VIP</h3>
                        </div>
                        <p className="text-xs text-text-muted font-medium tracking-wider pl-7">ACESSO MENSAL</p>
                    </div>
                    <div className={`px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest border ${isActive
                        ? 'bg-primary/10 text-primary border-primary/20'
                        : 'bg-red-500/10 text-red-500 border-red-500/20'
                        }`}>
                        {status === 'active' ? 'ATIVO' :
                            status === 'canceled_at_period_end' ? 'CANCELADO' :
                                status === 'past_due' ? 'ATRASADO' :
                                    status === 'unpaid' ? 'NÃO PAGO' :
                                        status.replace(/_/g, ' ')}
                    </div>
                </div>

                {/* Credits Section */}
                <div className="space-y-5 mb-8">
                    {/* Haircuts */}
                    <div>
                        <div className="flex justify-between items-end mb-2">
                            <div className="flex items-center gap-2 text-white">
                                <i className="ri-scissors-cut-fill text-primary"></i>
                                <span className="font-medium text-sm">Cortes de Cabelo</span>
                            </div>
                            <span className="text-sm font-bold text-white">{creditsHaircut} <span className="text-text-muted font-normal text-xs">/ 2 restantes</span></span>
                        </div>
                        <div className="h-2 w-full bg-gray-800 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-primary transition-all duration-500 ease-out shadow-[0_0_10px_rgba(255,215,0,0.5)]"
                                style={{ width: `${haircutProgress}%` }}
                            ></div>
                        </div>
                    </div>

                    {/* Beard Trims */}
                    <div>
                        <div className="flex justify-between items-end mb-2">
                            <div className="flex items-center gap-2 text-white">
                                <i className="ri-user-smile-fill text-primary"></i>
                                <span className="font-medium text-sm">Barba</span>
                            </div>
                            <span className="text-sm font-bold text-white">{creditsBeard} <span className="text-text-muted font-normal text-xs">/ 1 restante</span></span>
                        </div>
                        <div className="h-2 w-full bg-gray-800 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-primary transition-all duration-500 ease-out shadow-[0_0_10px_rgba(255,215,0,0.5)]"
                                style={{ width: `${beardProgress}%` }}
                            ></div>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="mt-auto pt-6 border-t border-amber-400/10/50 flex justify-between items-center">
                    <div>
                        <p className="text-[10px] uppercase tracking-widest text-text-muted mb-1">
                            {status === 'canceled_at_period_end' ? 'Expira em' : 'Renova em'}
                        </p>
                        <p className="text-sm font-mono text-white font-medium">
                            {currentPeriodEnd ? new Date(currentPeriodEnd).toLocaleDateString() : 'N/A'}
                        </p>
                    </div>
                    <div className="h-8 w-8 rounded-full bg-gradient-to-tr from-primary to-yellow-200 flex items-center justify-center shadow-lg shadow-primary/20">
                        <i className="ri-check-line text-black font-bold"></i>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MembershipCard;
