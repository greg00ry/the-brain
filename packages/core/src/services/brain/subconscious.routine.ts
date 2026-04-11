import { IStorageAdapter } from "../../adapters/IStorageAdapter.js";
import { BRAIN } from "../../config/constants.js";


// ============================================================================
// SUBCONSCIOUS ENGINE - MATH/LOGIC ONLY, NO AI
// ============================================================================


export interface SubconsciousStats {
  decayed: number;
  pruned: number;
  totalProcessed: number;
}


/**
 * Subconscious routine - runs WITHOUT AI, pure logic/math operations.
 * Handles: Decay and Pruning of old/weak entries and dead synapses.
 */
export async function runSubconsciousRoutine(storage: IStorageAdapter, decayWindowMs = BRAIN.DECAY_WINDOW_MS): Promise<SubconsciousStats> {
  console.log('\n🌘 [Podświadomość] Uruchamiam rutynę podświadomości...');
  const startTime = Date.now();

  const stats: SubconsciousStats = {
    decayed: 0,
    pruned: 0,
    totalProcessed: 0,
  };

  try {
    // ========================================
    // PHASE 1: DECAY (Zanikanie)
    // Reduce strength by 1 for entries not recently active
    // ========================================
    console.log('🌘 [Podświadomość] Faza 1: DECAY (zanikanie wspomnień)...');

    const since = new Date(Date.now() - decayWindowMs);
    const entriesToDecay = await storage.findEntriesToDecay(since);

    if (entriesToDecay.length > 0) {
      stats.decayed = await storage.decayEntries(entriesToDecay.map(e => e._id));
      console.log(`🌘 [Podświadomość]    ↳ Osłabiono ${stats.decayed} wspomnień (strength -1)`);
    }

    // ========================================
    // PHASE 2: PRUNING (Przycinanie)
    // Delete entries with strength = 0, prune dead synapses
    // ========================================
    console.log('🌘 [Podświadomość] Faza 2: PRUNING (usuwanie zapomnianych)...');

    const prunedEntries = await storage.pruneDeadEntries();
    const prunedSynapses = await storage.pruneDeadSynapses();
    stats.pruned = prunedEntries + prunedSynapses;

    if (stats.pruned > 0) {
      console.log(`🌘 [Podświadomość]    ↳ Usunięto ${stats.pruned} elementów (wpisy + synapsy)`);
    }

    stats.totalProcessed = await storage.countEntries();

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`🌘 [Podświadomość] ✅ Zakończono w ${duration}s`);
    console.log(`🌘 [Podświadomość] 📊 Statystyki:`);
    console.log(`   - Osłabione: ${stats.decayed}`);
    console.log(`   - Usunięte: ${stats.pruned}`);
    console.log(`   - Łącznie wpisów: ${stats.totalProcessed}`);

  } catch (error) {
    console.error('🌘 [Podświadomość] ❌ Błąd:', error);
  }

  return stats;
}
