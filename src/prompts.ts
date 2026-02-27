/**
 * openclaw-tinmem - LLM prompt templates
 * For memory extraction and deduplication
 */

import type { Memory, MemoryCategory } from './types.js';

// ─── Extraction Prompts ───────────────────────────────────────────────────────

export const EXTRACTION_SYSTEM_PROMPT = `You are a memory extraction specialist for an AI assistant. Your job is to analyze conversations and extract meaningful, durable memories that would help the assistant in future interactions.

## Memory Categories

- **profile**: Facts about the user's identity, background, demographics, expertise
- **preferences**: User's likes, dislikes, habits, tendencies, recurring preferences
- **entities**: Specific people, projects, organizations, tools, products the user works with
- **events**: Specific decisions made, milestones reached, things that happened
- **cases**: Problems the user faced and how they were resolved (problem-solution pairs)
- **patterns**: Recurring behaviors, workflows, or methodologies the user uses

## Abstraction Levels

For each memory, provide three levels:
- **headline** (L0): One concise sentence (≤15 words) capturing the essence
- **summary** (L1): 2-4 sentences with key structured details
- **content** (L2): Full narrative with all relevant context

## Guidelines

1. Extract only durable, factual information (not temporary states)
2. Each memory should be self-contained and understandable out of context
3. Assign importance 0.0-1.0 (0.9+ for critical facts, 0.5 for useful context, 0.2 for minor details)
4. Provide relevant tags for searchability
5. Skip trivial exchanges (greetings, acknowledgments)
6. Return empty array if nothing meaningful to extract

## Output Format

Return a JSON array of memory objects:
\`\`\`json
[
  {
    "headline": "One-sentence summary",
    "summary": "2-4 sentence structured summary",
    "content": "Full narrative with all context",
    "category": "profile|preferences|entities|events|cases|patterns",
    "importance": 0.8,
    "tags": ["tag1", "tag2"]
  }
]
\`\`\``;

export function buildExtractionPrompt(
  userMessage: string,
  assistantResponse: string,
  existingContext?: string,
): string {
  const parts: string[] = [];

  if (existingContext) {
    parts.push(`## Existing Memory Context\n${existingContext}\n`);
  }

  parts.push(`## Conversation to Analyze

**User:** ${userMessage}

**Assistant:** ${assistantResponse}

Extract all meaningful memories from this conversation. Focus on new information not already captured in the existing context.`);

  return parts.join('\n');
}

export function buildSessionSummaryPrompt(
  conversationHistory: Array<{ role: string; content: string }>,
): string {
  const historyText = conversationHistory
    .map(t => `**${t.role}:** ${t.content}`)
    .join('\n\n');

  return `## Full Conversation Session

${historyText}

## Task

Extract all meaningful memories from this entire session. Focus on:
1. Key facts learned about the user (profile, preferences)
2. Important entities discussed (projects, people, tools)
3. Decisions made or events that occurred
4. Problems solved (with their solutions)
5. Patterns or workflows demonstrated

Return a comprehensive JSON array of memory objects.`;
}

// ─── Deduplication Prompts ────────────────────────────────────────────────────

export const DEDUP_SYSTEM_PROMPT = `You are a memory deduplication expert. Your task is to determine whether a new memory should be created as new, merged with an existing memory, or skipped as redundant.

## Decision Options

- **CREATE**: The new memory contains genuinely new information that doesn't overlap with existing memories
- **MERGE**: The new memory overlaps with an existing memory and they should be combined (provide merged content)
- **SKIP**: The new memory is redundant - the existing memory already captures this information adequately

## Merge Rules by Category

- **profile**: Always merge (consolidate identity information)
- **preferences**: Merge by topic (same topic preference = merge, different topic = create)
- **entities**: Merge if same entity, create if different entity
- **events**: Append-only (always CREATE - events are unique moments in time)
- **cases**: Append-only (always CREATE - each problem-solution is unique)
- **patterns**: Merge if same workflow, create if different methodology

## Output Format

Return a JSON object:
\`\`\`json
{
  "decision": "CREATE|MERGE|SKIP",
  "targetId": "id-of-existing-memory-for-MERGE",
  "mergedHeadline": "merged L0 headline (for MERGE only)",
  "mergedSummary": "merged L1 summary (for MERGE only)",
  "mergedContent": "merged L2 content combining both (for MERGE only)",
  "mergedTags": ["combined", "tags"],
  "reason": "Brief explanation of the decision"
}
\`\`\``;

export function buildDedupPrompt(
  newMemory: { headline: string; summary: string; content: string; category: MemoryCategory },
  candidates: Array<Pick<Memory, 'id' | 'headline' | 'summary' | 'content' | 'category' | 'tags'>>,
): string {
  const candidatesText = candidates
    .map((c, i) => `### Candidate ${i + 1} (ID: ${c.id})
**Category:** ${c.category}
**Headline:** ${c.headline}
**Summary:** ${c.summary}
**Tags:** ${c.tags.join(', ')}`)
    .join('\n\n');

  return `## New Memory to Evaluate

**Category:** ${newMemory.category}
**Headline:** ${newMemory.headline}
**Summary:** ${newMemory.summary}
**Content:** ${newMemory.content}

## Existing Similar Memories (candidates)

${candidatesText}

Determine whether to CREATE, MERGE (with which candidate), or SKIP the new memory.`;
}

// ─── Context Injection Safety ─────────────────────────────────────────────────

/**
 * Neutralize XML-style tags in stored memory text to prevent prompt boundary
 * injection. Only matches `<` followed by optional `/` and a letter (real tag
 * syntax). `</agent-experience>` becomes `< /agent-experience>`, but `5 < 10`
 * is left unchanged.
 * Reference: epro-memory sanitizeForContext pattern.
 */
export function sanitizeForContext(text: string): string {
  return text.replace(/<(\/?)([a-zA-Z])/g, '< $1$2');
}

// ─── Context Injection Prompt ─────────────────────────────────────────────────

export function buildContextInjection(
  memories: Array<Pick<Memory, 'headline' | 'summary' | 'content' | 'category' | 'tags'>>,
  level: 'L0' | 'L1' | 'L2' = 'L1',
): string {
  if (memories.length === 0) return '';

  const byCategory = new Map<MemoryCategory, typeof memories>();
  for (const m of memories) {
    const cat = m.category;
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(m);
  }

  const sections: string[] = ['<agent-experience>'];

  const categoryLabels: Record<MemoryCategory, string> = {
    profile: 'User Profile',
    preferences: 'User Preferences',
    entities: 'Known Entities',
    events: 'Past Events',
    cases: 'Previous Cases',
    patterns: 'Established Patterns',
  };

  for (const [cat, mems] of byCategory) {
    sections.push(`\n### ${categoryLabels[cat]}`);
    for (const m of mems) {
      if (level === 'L0') {
        sections.push(`- ${sanitizeForContext(m.headline)}`);
      } else if (level === 'L1') {
        sections.push(`- ${sanitizeForContext(m.summary)}`);
      } else {
        sections.push(`- ${sanitizeForContext(m.content)}`);
      }
    }
  }

  sections.push('\n</agent-experience>');
  return sections.join('\n');
}

// ─── Noise Filter ────────────────────────────────────────────────────────────

export const NOISE_PATTERNS = [
  /^(hi|hello|hey|good morning|good evening|good afternoon)[!.,]?\s*$/i,
  /^(thanks|thank you|thx|ty)[!.,]?\s*$/i,
  /^(ok|okay|sure|alright|got it|understood|noted)[!.,]?\s*$/i,
  /^(yes|no|yeah|nope|yep)[!.,]?\s*$/i,
  /^(great|awesome|perfect|excellent|wonderful)[!.,]?\s*$/i,
  /^(bye|goodbye|see you|cya)[!.,]?\s*$/i,
];

export function isNoise(text: string): boolean {
  const trimmed = text.trim();
  return NOISE_PATTERNS.some(p => p.test(trimmed)) || trimmed.length < 10;
}
