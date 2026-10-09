// =========================================================
// VYRO — APP CONFIGURATION (DEVNET TEST COPY)
// =========================================================
// Fill in the two lines marked  <<< PUT YOUR ... HERE  and nothing else needs to change.

window.VYRO_CONFIG = Object.freeze({
    appName: "VYRO",

    network: "solana",
    asset: "USDC",

    solana: Object.freeze({
        // Solana DEVNET (used by WalletConnect).
        chainId: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",

        // <<< PUT YOUR DEVNET RPC URL HERE (your Alchemy devnet URL, key included)
        rpcUrl: "https://solana-devnet.g.alchemy.com/v2/YOUR_ALCHEMY_KEY",

        // Devnet USDC.
        usdcMint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
        usdcDecimals: 6,

        explorerTxUrl: "https://solscan.io/tx/",
        explorerSuffix: "?cluster=devnet"
    }),

    // VYRO service fee: charged to the SENDER on top of the payment (the recipient gets the full
    // amount). 100 basis points = 1%. Sent to the fee wallet inside the same transaction.
    fee: Object.freeze({
        bps: 100,
        treasuryAddress: "Uh6ubJa9zWpZ4GVBcD7aBMMGi4Y3wy1zycG8yBYZzvU"
    }),

    limits: Object.freeze({
        minAmountPerPayment: "1",      // USDC ($1)
        maxAmountPerPayment: "10000"   // USDC
    }),

    // <<< PUT YOUR WALLETCONNECT PROJECT ID HERE (between the quotes)
    walletConnectProjectId: "",
    walletConnectMetadata: {
        name: "VYRO",
        description: "Non-custodial crypto transfers by username.",
        url: window.location.origin,
        icons: []
    }
});
