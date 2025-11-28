export const DESIGN = {
    // Layout
    layout: {
        pageContainer: "h-screen bg-pattern text-text-primary overflow-hidden",
        contentContainer: "p-4 md:p-8 max-w-7xl mx-auto w-full",
    },

    // Cards
    card: {
        base: "bg-dark-card rounded-xl shadow-lg border border-neutral-800",
        hover: "hover:border-primary transition-colors duration-300",
        padding: "p-6",
    },

    // Typography
    text: {
        header: "text-2xl font-bold text-white",
        subHeader: "text-xl font-bold text-white",
        body: "text-text-secondary",
        muted: "text-text-muted",
        label: "block text-sm font-medium text-text-secondary mb-1",
    },

    // Inputs
    input: {
        base: "w-full px-4 py-3 border border-neutral-700 rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none bg-dark-input text-white placeholder-gray-500 transition-all",
        select: "w-full px-4 py-3 border border-neutral-700 rounded-lg focus:ring-1 focus:ring-primary focus:border-primary outline-none bg-dark-input text-white appearance-none",
    },

    // Buttons
    button: {
        primary: "bg-primary text-black font-bold py-3 px-6 rounded-lg hover:bg-yellow-400 transition-all shadow-lg shadow-primary/20 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none",
        secondary: "bg-dark-input text-white font-medium py-3 px-6 rounded-lg hover:bg-gray-700 transition-all border border-neutral-700",
        icon: "p-2 hover:bg-gray-800 rounded-full transition-colors text-white",
    },

    // Badges/Tags
    badge: {
        base: "px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider",
        success: "bg-green-900/30 text-green-400 border border-green-800",
        warning: "bg-yellow-900/30 text-yellow-400 border border-yellow-800",
        error: "bg-red-900/30 text-red-400 border border-red-800",
        info: "bg-blue-900/30 text-blue-400 border border-blue-800",
    },

    // Interactive Elements (Selection Cards)
    selectionCard: {
        base: "border rounded-xl p-4 cursor-pointer transition-all flex items-center gap-4",
        selected: "border-primary bg-primary/10",
        unselected: "border-neutral-700 hover:border-neutral-500 bg-dark-input",
    }
};
