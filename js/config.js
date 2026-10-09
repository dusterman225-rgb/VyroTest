// =========================================================
// VYRO — APP CONFIGURATION
// =========================================================
// Everything network-specific lives here so that adding a new chain
// or asset later is a config change, not a code hunt.

window.VYRO_CONFIG = Object.freeze({
    appName: "VYRO",

    // Active payment rail (V1: USDC on Solana mainnet).
    network: "solana",
    asset: "USDC",

        solana: Object.freeze({
        // DEVNET (testing only). Switch back to mainnet values before launch.
        chainId: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",

        rpcUrl: "https://api.devnet.solana.com",

        // Circle's devnet USDC mint (the token shown as 4zMM...ncDU in Solflare).
        usdcMint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
        usdcDecimals: 6,

        explorerTxUrl: "https://solscan.io/tx/",
        explorerSuffix: "?cluster=devnet"
    }),

        fee: Object.freeze({
        bps: 100,
        treasuryAddress: "Uh6ubJa9zWpZ4GVBcD7aBMMGi4Y3wy1zycG8yBYZzvU"
    }),
                              
    // Safety limits enforced client-side (UX guard-rails, not security controls).
    limits: Object.freeze({
        maxAmountPerPayment: "10000"   // USDC
    }),

    // Optional: add your WalletConnect Cloud project ID here.
    // Injected wallets (Trust Wallet / Phantom / Solflare / Backpack) do not require it.
    walletConnectProjectId: "44f320d19361d5829141766a65015080",
    walletConnectMetadata: {
        name: "VYRO",
        description: "Non-custodial crypto transfers by username.",
        url: window.location.origin,
        icons: []
    }
});
          
