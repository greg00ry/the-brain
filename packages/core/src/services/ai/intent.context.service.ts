import { IVaultEntry } from "../../types/brain.js";
import { IStorageAdapter } from "../../adapters/IStorageAdapter.js";
import { IEmbeddingAdapter } from "../../adapters/IEmbeddingAdapter.js";
import { MEMORY } from "../../config/constants.js";

// ═══════════════════════════════════════════════════════════════════════════════
// INTENT CONTEXT SERVICE - Recursive Branching Retrieval (3x3)
// ═══════════════════════════════════════════════════════════════════════════════

interface SynapseNode {
  entryId: string;
  summary: string;
  weight: number;
  reason: string;
  level: number;
  children: SynapseNode[];
}

// ─── Recursive Synaptic Tree (3x3) ───────────────────────────────────────────

export async function getSynapticTree(
  startEntryId: string,
  storage: IStorageAdapter,
  depth = 1,
  visited: Set<string> = new Set(),
  currentLevel = 1,
  branchFactor: number = MEMORY.SYNAPSE_BRANCH_FACTOR,
): Promise<SynapseNode[]> {
  if (depth <= 0 || visited.has(startEntryId)) return [];

  visited.add(startEntryId);

  try {
    const synapses = await storage.getSynapsesBySource(startEntryId, branchFactor);

    if (synapses.length === 0) return [];

    const nodes: SynapseNode[] = [];

    for (const synapse of synapses) {
      const targetId = synapse.targetId;
      const summary = synapse.targetSummary
        || synapse.targetRawText?.substring(0, MEMORY.RAW_TEXT_PREVIEW_LENGTH)
        || 'Brak opisu';

      const children = await getSynapticTree(targetId, storage, depth - 1, visited, currentLevel + 1, branchFactor);

      nodes.push({
        entryId: targetId,
        summary,
        weight: synapse.weight,
        reason: synapse.reason || 'semantyczne podobieństwo',
        level: currentLevel,
        children,
      });
    }

    return nodes;
  } catch (error) {
    console.error(`[ContextService] Error getting synaptic tree for ${startEntryId}:`, error);
    return [];
  }
}

// ─── Format Synaptic Tree ─────────────────────────────────────────────────────

export function formatSynapticTree(nodes: SynapseNode[], indent = ''): string {
  if (nodes.length === 0) return '';

  let formatted = '';

  nodes.forEach((node, idx) => {
    const isLast = idx === nodes.length - 1;
    const prefix = indent + (isLast ? '└─' : '├─');
    const weight = (node.weight * 10).toFixed(1);

    formatted += `${prefix} [Lvl ${node.level}] ${node.reason} → "${node.summary}" (Waga: ${weight}/10)\n`;

    if (node.children.length > 0) {
      const childIndent = indent + (isLast ? '   ' : '│  ');
      formatted += formatSynapticTree(node.children, childIndent);
    }
  });

  return formatted;
}

// ─── Merge entries (dedup by _id) ────────────────────────────────────────────

function mergeEntries(arrays: IVaultEntry[][]): IVaultEntry[] {
  const seen = new Set<string>();
  const result: IVaultEntry[] = [];
  for (const arr of arrays) {
    for (const entry of arr) {
      const id = entry._id.toString();
      if (!seen.has(id)) {
        seen.add(id);
        result.push(entry);
      }
    }
  }
  return result;
}

// ─── Get Brain Context ────────────────────────────────────────────────────────

export async function getBrainContext(
  userId: string,
  userText: string,
  storage: IStorageAdapter,
  embeddingAdapter?: IEmbeddingAdapter,
  memoryConfig?: {
    synapseTreeDepth?: number;
    synapseBranchFactor?: number;
    contextTopEntries?: number;
  },
): Promise<{
  relevantEntries: IVaultEntry[];
  synapticTree: string;
  hasContext: boolean;
}> {
  const treeDepth = memoryConfig?.synapseTreeDepth ?? MEMORY.SYNAPSE_TREE_DEPTH;
  const branchFactor = memoryConfig?.synapseBranchFactor ?? MEMORY.SYNAPSE_BRANCH_FACTOR;
  const topEntries = memoryConfig?.contextTopEntries ?? MEMORY.CONTEXT_TOP_ENTRIES;

  try {
    const keywords = extractKeywords(userText);
    if (!embeddingAdapter) {
      console.warn('[Brain] ⚠️  No embedding adapter provided — using keyword search only. Semantic retrieval disabled.');
    }

    let entries: IVaultEntry[];

    if (embeddingAdapter) {
      const terms = keywords.slice(0, MEMORY.MULTI_QUERY_MAX_TERMS);

      if (terms.length === 0) {
        // No keywords — fall back to full-text embedding
        const vector = await embeddingAdapter.embed(userText);
        entries = await storage.findSimilarEntries(userId, vector, topEntries);
      } else {
        // Multi-query: embed each term separately, merge results
        const results = await Promise.all(
          terms.map(async (term) => {
            const vector = await embeddingAdapter.embed(term);
            return storage.findSimilarEntries(userId, vector, topEntries);
          }),
        );
        entries = mergeEntries(results).slice(0, topEntries);
      }
    } else {
      if (keywords.length === 0) {
        return { relevantEntries: [], synapticTree: '💭 Brak słów kluczowych do wyszukania.\n', hasContext: false };
      }
      // Multi-query: query each term separately, merge results
      const terms = keywords.slice(0, MEMORY.MULTI_QUERY_MAX_TERMS);
      const results = await Promise.all(
        terms.map(term => storage.findRelevantEntries(userId, [term])),
      );
      entries = mergeEntries(results);
    }

    if (entries.length === 0) {
      return { relevantEntries: [], synapticTree: '💭 Brak relevantnych wspomnień w bazie.\n', hasContext: false };
    }

    let synapticTreeFormatted = '🧠 DRZEWO SYNAPTYCZNE (3x3 Branching):\n\n';

    for (const entry of entries) {
      const entryId = entry._id.toString();
      const summary = entry.isPermanent
        ? entry.rawText.substring(0, MEMORY.RAW_TEXT_PREVIEW_LENGTH)
        : entry.analysis?.summary || entry.rawText.substring(0, MEMORY.RAW_TEXT_PREVIEW_LENGTH);

      synapticTreeFormatted += `📍 START: "${summary}"\n`;

      const tree = await getSynapticTree(entryId, storage, treeDepth, new Set(), 1, branchFactor);
      synapticTreeFormatted += tree.length > 0
        ? formatSynapticTree(tree)
        : '   (brak połączeń)\n';

      synapticTreeFormatted += '\n';
    }

    return { relevantEntries: entries, synapticTree: synapticTreeFormatted, hasContext: true };
  } catch (error) {
    console.error('[ContextService] Error getting brain context:', error);
    return { relevantEntries: [], synapticTree: '⚠️ Błąd podczas pobierania kontekstu.\n', hasContext: false };
  }
}

// ─── Keyword Extraction ───────────────────────────────────────────────────────

function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    'i', 'a', 'o', 'w', 'z', 'na', 'do', 'po', 'że', 'się', 'od', 'przez',
    'dla', 'przy', 'za', 'przed', 'jak', 'co', 'który', 'ale', 'czy', 'to',
    'jest', 'był', 'będzie', 'ma', 'może', 'mój', 'twój', 'jego', 'jej',
    'the', 'is', 'at', 'which', 'on', 'a', 'an', 'as', 'are', 'was', 'were',
  ]);

  const words = text
    .toLowerCase()
    .replace(/[^\wąćęłńóśźżĄĆĘŁŃÓŚŹŻ\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.has(word));

  return [...new Set(words)];
}
