// =========================================================
// VYRO — PAYMENT ENGINE (non-custodial)
// =========================================================
// Flow:  quote()  → resolves @username → address, checks balances, builds a preview
//        submit() → rebuilds a fresh unsigned tx, hands it to the USER's wallet to sign,
//                   broadcasts/confirms it, and records it in the sender's own history.
//
// VYRO never holds funds, never holds keys and never signs. If the user declines in
// their wallet, nothing happens.
// =========================================================
(function () {
    "use strict";

    const CFG = window.VYRO_CONFIG;
    const SOL = CFG.solana;

    let pending = null;      // in-memory only: a half-finished payment should not outlive the tab
    let connection = null;
    let inFlight = false;

    function getConnection() {
        if (!window.solanaWeb3) throw new Error("Solana library failed to load. Check your connection and reload.");
        if (!connection) connection = new solanaWeb3.Connection(SOL.rpcUrl, "confirmed");
        return connection;
    }

    // ---------- pending payment ----------
    function setPendingPayment(p) { pending = p ? Object.assign({}, p) : null; }
    function getPendingPayment() { return pending ? Object.assign({}, pending) : null; }
    function clearPendingPayment() { pending = null; }

    // ---------- validation ----------
    function validatePayment(p) {
        if (!p) return { valid: false, error: "No payment is waiting for confirmation." };
        if (!VYROTransfer.isValidUsername(VYROTransfer.normalizeUsername(p.recipient))) return { valid: false, error: "Recipient username is invalid." };
        const amt = VYROTransfer.parseAmount(p.amount, SOL.usdcDecimals);
        if (!amt.ok) return { valid: false, error: amt.error };
        if (amt.units > VYROTransfer.parseAmount(CFG.limits.maxAmountPerPayment, SOL.usdcDecimals).units)
            return { valid: false, error: "Amount is above the " + CFG.limits.maxAmountPerPayment + " USDC per-payment limit." };
        if (p.network && String(p.network).toLowerCase() !== "solana") return { valid: false, error: "This payment network is not supported yet." };
        if (p.asset && p.asset !== "USDC") return { valid: false, error: "This payment asset is not supported yet." };
        return { valid: true, units: amt.units, error: null };
    }

    function validateWallet(address) {
        if (!window.VYROWallet) return { valid: false, error: "VYRO wallet system is unavailable." };
        if (!VYROWallet.isConnected()) return { valid: false, error: "Please connect a wallet before sending." };
        const wallet = address
            ? VYROWallet.getWallets().find(function (w) { return w.address === address; })
            : VYROWallet.getActiveWallet();
        if (!wallet || !wallet.address) return { valid: false, error: "The selected wallet is not available." };
        if (wallet.network && wallet.network !== "solana") return { valid: false, error: "The selected wallet is not on Solana." };
        return { valid: true, wallet: wallet, error: null };
    }

    // ---------- recipient resolution ----------
    async function resolveRecipient(rawUsername) {
        const name = VYROTransfer.normalizeUsername(rawUsername);
        if (!VYROTransfer.isValidUsername(name)) throw userError("Enter a valid VYRO username.");
        let snap;
        try { snap = await firebaseDB.collection("usernames").doc(name).get(); }
        catch (e) { console.error("VYRO resolve error:", e); throw userError("Could not look up @" + name + ". Check your connection and try again."); }
        if (!snap.exists) throw userError("@" + name + " was not found on VYRO.");
        const data = snap.data() || {};
        if (!data.walletAddress || !VYROTransfer.isValidSolanaAddress(data.walletAddress))
            throw userError("@" + name + " has not set up a receiving wallet yet.");
        const me = firebaseAuth.currentUser;
        if (me && data.uid === me.uid) throw userError("You can't send a payment to yourself.");
        return { username: name, uid: data.uid, address: data.walletAddress };
    }

    function userError(message) { const e = new Error(message); e.userFacing = true; return e; }

    // ---------- quote (shown on the confirm screen) ----------
    async function quote() {
        const p = getPendingPayment();
        const pv = validatePayment(p);
        if (!pv.valid) throw userError(pv.error);
        const wv = validateWallet(p.fromWallet);
        if (!wv.valid) throw userError(wv.error);

        const to = await resolveRecipient(p.recipient);
        const built = await buildWithFriendlyErrors(wv.wallet.address, to.address, pv.units);

        pending = Object.assign({}, p, {
            recipientAddress: to.address,
            recipientUid: to.uid,
            units: pv.units.toString(),
            createsRecipientAccount: built.createsRecipientAccount,
            rentLamports: built.rentLamports,
            feeLamports: built.feeLamports
        });
        return getPendingPayment();
    }

    async function buildWithFriendlyErrors(sender, recipient, units) {
        try {
            return await VYROTransfer.buildUsdcTransfer({ connection: getConnection(), config: SOL, sender: sender, recipient: recipient, units: units });
        } catch (e) {
            if (e.code === "INSUFFICIENT_USDC" || e.code === "INSUFFICIENT_SOL") throw userError(e.message);
            console.error("VYRO build error:", e);
            throw userError("Could not reach the Solana network. Please try again in a moment.");
        }
    }

    // ---------- submit ----------
    // onStage(text) lets the UI show progress: "Preparing…", "Waiting for your wallet…", …
    async function submit(onStage) {
        if (inFlight) throw userError("A payment is already in progress.");
        inFlight = true;
        const stage = typeof onStage === "function" ? onStage : function () {};
        try {
            const p = getPendingPayment();
            const pv = validatePayment(p);
            if (!pv.valid) throw userError(pv.error);
            const wv = validateWallet(p.fromWallet);
            if (!wv.valid) throw userError(wv.error);
            const sender = wv.wallet.address;

            stage("Checking recipient…");
            // Re-resolve right before signing: if the recipient changed their address
            // since the confirm screen was shown, stop rather than pay a different address.
            const to = await resolveRecipient(p.recipient);
            if (p.recipientAddress && to.address !== p.recipientAddress)
                throw userError("@" + to.username + " changed their receiving wallet. Please review the payment again.");

            stage("Preparing…");
            const built = await buildWithFriendlyErrors(sender, to.address, pv.units);

            stage("Approve in your wallet…");
            let result;
            try { result = await VYROWallet.requestSignature(built.transaction, sender); }
            catch (e) {
                if (VYROWallet.isUserRejection(e)) throw userError("You declined the request in your wallet. No payment was made.");
                throw userError(e.message || "Your wallet could not sign this payment.");
            }

            let signature = result.signature;
            if (!signature) {
                stage("Submitting…");
                try {
                    signature = await getConnection().sendRawTransaction(result.signedRaw, { skipPreflight: false, preflightCommitment: "confirmed" });
                } catch (e) {
                    console.error("VYRO send error:", e);
                    throw userError("The network rejected this payment: " + (e.message || "unknown error") + ". No funds were moved.");
                }
            }

            // One shared receipt per payment. The sender writes it; both the sender and the
            // recipient can read it (see firestore.rules). The blockchain stays the source of truth.
            const me = firebaseAuth.currentUser;
            const record = {
                id: signature,
                fromUid: me.uid,
                fromUsername: (VYROWallet.getUsername && VYROWallet.getUsername()) || "",
                toUid: to.uid,
                toUsername: to.username,
                fromWallet: sender,
                recipientAddress: to.address,
                amount: VYROTransfer.formatUnits(pv.units, SOL.usdcDecimals),
                asset: "USDC",
                network: "Solana",
                status: "Submitted",
                type: "Send"
            };
            saveRecord(record);

            stage("Confirming on Solana…");
            const final = await waitForConfirmation(signature, built.lastValidBlockHeight);
            if (final !== "Submitted") updateRecordStatus(signature, final);

            clearPendingPayment();
            return Object.assign({}, record, { recipient: "@" + to.username, status: final });
        } finally {
            inFlight = false;
        }
    }

    // Polls the chain instead of trusting the wallet: the blockchain is the source of truth.
    async function waitForConfirmation(signature, lastValidBlockHeight) {
        const conn = getConnection();
        const deadline = Date.now() + 75000;
        while (Date.now() < deadline) {
            try {
                const res = await conn.getSignatureStatuses([signature], { searchTransactionHistory: false });
                const st = res && res.value && res.value[0];
                if (st) {
                    if (st.err) return "Failed";
                    if (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized") return "Confirmed";
                }
                if (lastValidBlockHeight && (await conn.getBlockHeight("confirmed")) > lastValidBlockHeight && !st) return "Failed";
            } catch (e) { /* transient RPC error: keep polling */ }
            await new Promise(function (r) { setTimeout(r, 2000); });
        }
        return "Submitted"; // still pending; the history screen links to the explorer
    }

    // ---------- history (sent AND received) ----------
    // Each payment is one document in `payments/{signature}`. The sender writes it after
    // signing; the sender and the recipient can both read it. Nobody else can.
    function paymentsCol() { return firebaseDB.collection("payments"); }

    function saveRecord(record) {
        try {
            paymentsCol().doc(record.id).set(Object.assign({}, record, { createdAt: firebase.firestore.FieldValue.serverTimestamp() }))
                .catch(function (e) { console.warn("VYRO: could not save history", e); });
        } catch (e) { console.warn("VYRO: could not save history", e); }
    }
    function updateRecordStatus(signature, status) {
        try { paymentsCol().doc(signature).update({ status: status }).catch(function (e) { console.warn("VYRO: status update failed", e); }); }
        catch (e) { /* history is best-effort; the chain is the source of truth */ }
    }

    function millis(t) { return t && typeof t.toMillis === "function" ? t.toMillis() : Date.now(); }

    // Turns a stored receipt into what the screens need, from THIS user's point of view.
    function decorate(d, myUid) {
        const sent = d.fromUid === myUid;
        return Object.assign({}, d, {
            direction: sent ? "sent" : "received",
            type: sent ? "Sent" : "Received",
            counterparty: "@" + ((sent ? d.toUsername : d.fromUsername) || "unknown"),
            recipient: "@" + (d.toUsername || "unknown"),   // kept for older screens
            time: millis(d.createdAt)
        });
    }

    // Does this receipt match what really happened on chain? A recipient should not trust
    // a receipt just because someone wrote it: check the transfer itself.
    async function verifyReceived(rec) {
        try {
            const conn = getConnection();
            const tx = await conn.getParsedTransaction(rec.id, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
            if (!tx) return Date.now() - rec.time > 120000 ? "Unverified" : null;   // not visible yet
            if (tx.meta && tx.meta.err) return "Failed";
            const w = window.solanaWeb3;
            const ata = VYROTransfer.deriveAta(new w.PublicKey(rec.recipientAddress), new w.PublicKey(SOL.usdcMint)).toBase58();
            const units = VYROTransfer.parseAmount(rec.amount, SOL.usdcDecimals);
            const ok = units.ok && tx.transaction.message.instructions.some(function (ix) {
                const p = ix.parsed;
                return p && p.type === "transferChecked" && p.info &&
                    p.info.destination === ata &&
                    p.info.mint === SOL.usdcMint &&
                    p.info.tokenAmount && p.info.tokenAmount.amount === units.units.toString();
            });
            return ok ? "Confirmed" : "Unverified";
        } catch (e) { return null; }   // network trouble: leave the stored status alone
    }

    // Updates "Submitted" receipts from the chain, so a payment shows Confirmed even if the
    // sender closed the app before it finished.
    async function refreshStatuses(list, myUid) {
        const open = list.filter(function (r) { return r.status === "Submitted"; });
        if (!open.length) return;
        try {
            const res = await getConnection().getSignatureStatuses(open.map(function (r) { return r.id; }), { searchTransactionHistory: true });
            open.forEach(function (r, i) {
                const st = res.value[i];
                if (!st) return;
                const next = st.err ? "Failed" : (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized") ? "Confirmed" : null;
                if (!next) return;
                r.status = next;
                if (r.fromUid === myUid) updateRecordStatus(r.id, next);   // only the sender may write it back
            });
        } catch (e) { /* leave statuses as stored */ }
    }

    async function loadHistory() {
        const me = firebaseAuth.currentUser;
        if (!me) return [];
        // Two simple queries (no composite index needed), merged and sorted here.
        const results = await Promise.all([
            paymentsCol().where("fromUid", "==", me.uid).limit(100).get(),
            paymentsCol().where("toUid", "==", me.uid).limit(100).get()
        ]);
        const byId = {};
        results.forEach(function (snap) { snap.docs.forEach(function (d) { byId[d.id] = d.data(); }); });
        const list = Object.keys(byId).map(function (id) { return decorate(byId[id], me.uid); });
        list.sort(function (a, b) { return b.time - a.time; });
        const recent = list.slice(0, 50);

        await refreshStatuses(recent, me.uid);
        await Promise.all(recent.filter(function (r) { return r.direction === "received" && r.status !== "Failed"; }).map(async function (r) {
            const v = await verifyReceived(r);
            if (v === "Unverified" || v === "Failed") r.status = v;
            else if (v === "Confirmed" && r.status === "Submitted") r.status = "Confirmed";
        }));
        return recent;
    }

    // ---------- balances (what the home screen shows) ----------
    // Reads the wallet's USDC and SOL straight from the chain.
    async function getBalances(address) {
        const conn = getConnection();
        const w = window.solanaWeb3;
        const owner = new w.PublicKey(address);
        const ata = VYROTransfer.deriveAta(owner, new w.PublicKey(SOL.usdcMint));
        let usdcUnits = 0n;
        try {
            const b = await conn.getTokenAccountBalance(ata, "confirmed");
            usdcUnits = BigInt(b.value.amount);
        } catch (e) {
            // No USDC account yet means a balance of zero. Anything else is a real error.
            if (!/could not find account/i.test(String(e && e.message))) throw e;
        }
        const lamports = await conn.getBalance(owner, "confirmed");
        return { usdc: VYROTransfer.formatUnits(usdcUnits, SOL.usdcDecimals), sol: lamports / 1e9 };
    }

    function explorerUrl(signature) { return SOL.explorerTxUrl + encodeURIComponent(signature) + (SOL.explorerSuffix || ""); }

    window.VYROPayments = {
        setPendingPayment, getPendingPayment, clearPendingPayment,
        validatePayment, validateWallet, resolveRecipient,
        quote, submit, loadHistory, getBalances, explorerUrl
    };
})();
