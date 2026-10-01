import { ci, cr, pr, PK, D, M } from "./config.js";
import { create as C } from "@web3-storage/w3up-client";
import { dbIGAI, dbTo, dbRef, dbGetRef } from "./supabase.js";
import { syncToNeonAndQdrant } from "./sync.js";
import { error, info, serializeError } from "./logger.js";
import { NonceManager as O } from "@ethersproject/experimental";
import ethers from "ethers";

let n = null;
let nonceLock = Promise.resolve();

const { providers, Contract, Wallet } = ethers,
  { JsonRpcProvider } = providers,
  w = PK ? new Wallet(PK, new JsonRpcProvider(pr)) : null,
  s = w ? new O(w) : null,
  q = [],
  c = await C(),
  r = w
    ? new Contract(ci, ["function deduct(address, address)"], w).connect(s)
    : null,
  t = w
    ? new Contract(
        cr,
        ["function balanceOf(address) view returns (uint256)"],
        w.provider,
      )
    : null;
let p = false;

const b = async () => {
  if (!c.currentSpace()) {
    await c.login(M);
    await c.setCurrentSpace(D);
  }
};

export async function ref(t, f) {
  try {
    if (!w) throw new Error("Blockchain wallet is not configured");
    if ((await dbTo(t)) && t != f) {
      await dbRef(t, f);
      await new Contract(ci, ["function setRef(address, address)"], w.provider)
        .connect(s)
        .setRef(t, f);
    }
  } catch (e) {
    error("ref_set_error", { error: serializeError(e) });
  }
}

export async function getInfo(a) {
  try {
    if (!t) throw new Error("Blockchain wallet is not configured");
    const [b, c] = await Promise.all([t.balanceOf(a), dbGetRef(a)]);
    return { balance: b.toString(), to: c.from || null, from: c.to || [] };
  } catch (e) {
    return e;
  }
}

async function getNextNonce() {
  await nonceLock;
  let releaseLock;
  nonceLock = new Promise((resolve) => {
    releaseLock = resolve;
  });
  try {
    if (n === null) {
      n = await w.provider.getTransactionCount(w.address, "pending");
      info("initial_nonce_fetched", { nonce: n });
    }
    const nonceToUse = n;
    n++;
    return nonceToUse;
  } finally {
    releaseLock();
  }
}

export async function processQueue() {
  if (p) return;
  p = true;
  while (q.length > 0) {
    const { d, ra, rt, aa } = q.shift();
    try {
      await b();
      let cid = null;
      try {
        cid = (
          await c.uploadFile(new File([JSON.stringify(d)], ""))
        ).toString();
      } catch (uploadErr) {
        error("cid_upload_failed", { error: serializeError(uploadErr) });
      }

      if (cid) {
        const dbResult = await dbIGAI(cid, ra, rt);
        if (dbResult) {
          syncToNeonAndQdrant(d, cid, dbResult.id, dbResult.created_at).catch(
            (e) => error("sync_neon_qdrant_error", { error: serializeError(e) })
          );
        }
      } else {
        const fallbackId = crypto.randomUUID();
        const fallbackCreatedAt = new Date().toISOString();
        syncToNeonAndQdrant(d, null, fallbackId, fallbackCreatedAt).catch(
          (e) => error("sync_neon_qdrant_error", { error: serializeError(e) })
        );
      }
    } catch (e) {
      error("queue_processing_retry", { error: serializeError(e) });
      q.push({ d, ra, rt, aa });
      await new Promise((r) => setTimeout(r, 5000));
    }
    info("queue_remaining", { remaining: q.length });
  }

  p = false;
}

export async function store(d, ra, rt, aa) {
  q.push({ d, ra, rt, aa });
  processQueue();
}
