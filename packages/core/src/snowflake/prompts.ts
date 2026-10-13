import type { SnowflakeStepNumber } from "../entities";
import type { PromptLocale } from "../templates/daily";
import { STEP_PROMPTS_DE } from "./prompts-de";
import { STEP_PROMPTS_UK } from "./prompts-uk";

/**
 * The bundled, offline prompt library (spec §4.1: rule + worked examples + reflective questions).
 * Static content — part of the repo, no network. Surfaces render through one provider shape
 * (decision 15 seam: a future opt-in AI provider would implement the same interface).
 */
export interface StepPrompt {
  rule: string;
  examples: Array<{ source: string; text: string }>;
  questions: string[];
}

/**
 * The prompt for a step in the writer's language (slice 16). English is the source set; Ukrainian
 * lives in `prompts-uk.ts` so the two read side by side, and a parity test keeps them in step.
 */
export function stepPrompt(locale: PromptLocale, step: SnowflakeStepNumber): StepPrompt {
  if (locale === "uk") return STEP_PROMPTS_UK[step];
  if (locale === "de") return STEP_PROMPTS_DE[step];
  return STEP_PROMPTS[step];
}

export const STEP_PROMPTS: Record<SnowflakeStepNumber, StepPrompt> = {
  1: {
    rule: "Write one sentence describing the whole story — the big picture, no character names (describe roles instead). Aim for 15–25 words.",
    examples: [
      {
        source: "Cinderella",
        text: "An orphaned girl, kept as a servant by her stepfamily, gets one enchanted night to win a prince's heart — and loses a glass slipper at midnight.",
      },
      {
        source: "Pride and Prejudice",
        text: "A proud gentleman and a sharp-witted young woman must overcome their own flaws before they can admit they love each other.",
      },
      {
        source: "Frankenstein",
        text: "A young scientist creates a living being and abandons it, and the creature's lonely revenge destroys everything the scientist loves.",
      },
    ],
    questions: [
      "Who is the story about — as a role, not a name?",
      "What does that person want more than anything?",
      "Who or what stands in the way?",
      "What is at stake if they fail?",
      "What changes in the world between the first and last page?",
      "Would a stranger keep reading past this sentence?",
    ],
  },
  2: {
    rule: "One paragraph of five sentences: the setup, then three escalating disasters (one ends each quarter of the story), then the ending.",
    examples: [
      {
        source: "Cinderella",
        text: "Setup: a girl is kept as a servant by her stepfamily. Disaster 1: the royal ball's invitation reaches her, but she is forbidden to go. Disaster 2: a fairy godmother sends her anyway, on a midnight deadline. Disaster 3: she flees at midnight and the prince is left with only a slipper. Ending: the slipper fits, and she is found.",
      },
      {
        source: "Pride and Prejudice",
        text: "Setup: a young woman meets a proud, wealthy gentleman. Disaster 1: he insults her at a ball. Disaster 2: she refuses his proposal and accuses him of ruining her sister's chance. Disaster 3: his letter reveals her own family's scandal — and him as the fixer. Ending: both shed their pride and prejudice, and they marry.",
      },
      {
        source: "Frankenstein",
        text: "Setup: a scientist discovers the secret of life. Disaster 1: his creature horrifies him and he abandons it. Disaster 2: the creature, rejected by everyone, kills the scientist's youngest brother. Disaster 3: it demands a companion and kills again when refused. Ending: the scientist dies chasing his creation, which mourns him and disappears.",
      },
    ],
    questions: [
      "What does the world look like before everything changes?",
      "What is the first blow that makes the goal urgent?",
      "How do things get worse — twice more?",
      "Which disaster is the darkest turn?",
      "How does it end — in one sentence?",
      "Does the ending answer the setup?",
    ],
  },
  3: {
    rule: "One page per major character: name, motivation (what they want abstractly), goal (what they pursue concretely), conflict (what blocks them), epiphany (what they learn or become).",
    examples: [
      {
        source: "Cinderella",
        text: "Motivation: to be seen as worthy. Goal: to attend the ball just once. Conflict: her stepfamily's cruelty and her own servitude. Epiphany: worth is not granted by others — she must claim it.",
      },
      {
        source: "Pride and Prejudice",
        text: "Motivation: to marry for love, not advantage. Goal: to understand — and be understood by — Mr Darcy. Conflict: his pride, her prejudice, and the scandalous behaviour of her family. Epiphany: first impressions lie; she must judge others and herself more carefully.",
      },
      {
        source: "Frankenstein",
        text: "Motivation: to be loved and accepted. Goal: a companion who looks like him. Conflict: every human he meets flees or attacks. Epiphany: he will never belong — and he chooses revenge over despair.",
      },
    ],
    questions: [
      "What does this character want so badly they'd lose something precious for it?",
      "What concrete goal do they pursue on the page?",
      "What or who blocks the goal?",
      "What do they learn — or refuse to learn — by the end?",
      "How would they describe themselves in one line?",
    ],
  },
  4: {
    rule: "Expand each of the five step-2 sentences into a paragraph. Keep the same order; each paragraph is one quarter of the story, and the disasters should escalate.",
    examples: [
      {
        source: "Cinderella",
        text: "Expanding 'Disaster 2' — the midnight deadline paragraph: the ballroom glitter, the dance she was never meant to have, the clock she forgets until it chimes, the staircase she sprints down while glass and magic fall away behind her.",
      },
      {
        source: "Pride and Prejudice",
        text: "Expanding 'Disaster 3' — the letter paragraph: Darcy's account of Wickham's true character, the revelation that he shielded her sister's reputation, and the slow collapse of every certainty Elizabeth held about both men.",
      },
      {
        source: "Frankenstein",
        text: "Expanding 'Disaster 2' — the aftermath paragraph: the news from Geneva, the gates of the city at night, the glimpse of a vast figure at the murder site, and Victor's dawning certainty that his creation is stalking his family.",
      },
    ],
    questions: [
      "Which step-2 sentence is hardest to expand — and why?",
      "Does each paragraph end with more at stake than the last?",
      "Is any paragraph doing two disasters' work?",
      "Whose decisions drive this quarter of the story?",
      "What did you cut from step 2 that belonged here?",
    ],
  },
  5: {
    rule: "One page per major character, half a page per minor one — each told from inside that character's own point of view.",
    examples: [
      {
        source: "Cinderella",
        text: "The ball, told from inside: not 'she went to the ball' but the borrowed dress that fits too well, the fear of being recognised, the strange arithmetic of wanting to stay and needing to leave.",
      },
      {
        source: "Pride and Prejudice",
        text: "The first proposal, from Darcy's side: his certainty that he is a gift, his rehearsed speeches about her inferior connections, and the bewilderment of a man discovering he can be refused.",
      },
      {
        source: "Frankenstein",
        text: "The first night of life, from the creature's side: cold, light that stings, hunger that is not yet hunger, and a maker who runs away — the moment the world teaches him what he is.",
      },
    ],
    questions: [
      "What does this character notice that nobody else would?",
      "What are they wrong about — inside their own story?",
      "Which scene looks completely different from their side?",
      "What do they never say out loud?",
      "Does this page make you want to write their scenes next?",
    ],
  },
  6: {
    rule: "Expand the step-4 paragraphs into a four-page synopsis — four sections, roughly one quarter of the book each.",
    examples: [
      {
        source: "Cinderella",
        text: "Section 2 grows into subplots: the stepmother's ambitions for her own daughters, the prince's boredom with protocol, and the invitation list as a battlefield.",
      },
      {
        source: "Pride and Prejudice",
        text: "Section 3 folds in the secondary courtships: Jane and Bingley's separation, Wickham's courtship of Elizabeth, and Lydia's elopement as the lowest point.",
      },
      {
        source: "Frankenstein",
        text: "Section 4 braids the chase: the creature's demands, Victor's wedding-night dread, the deaths accumulating behind him as he pursues it north.",
      },
    ],
    questions: [
      "Which subplot surfaces in this section first?",
      "Where does tension drop — and what raises it again?",
      "Who discovers something they did not know at the start of the section?",
      "Is the pacing of the four sections balanced?",
      "What is the midpoint shift, in one line?",
    ],
  },
  7: {
    rule: "Build the detailed chart per character: appearance, backstory, voice, and the freeform bible notes — enough that any scene can be written without re-deciding who they are.",
    examples: [
      {
        source: "Cinderella",
        text: "Voice chart: speaks little and politely in Act I, then with quiet steel; her mother's turns of phrase keep surfacing in her lines.",
      },
      {
        source: "Pride and Prejudice",
        text: "Backstory chart: Darcy's upbringing, his sister's history, and the exact shape of his father's promise to Wickham — the facts behind every Shrew of his behaviour.",
      },
      {
        source: "Frankenstein",
        text: "Appearance chart: assembled from parts, eight feet tall, faster and stronger than any man — and the linguistic education chart that follows the creature from grunts to Milton.",
      },
    ],
    questions: [
      "Which fields are still empty for your protagonist — and do they need to be?",
      "What does this character sound like when furious?",
      "Which single object defines them?",
      "What does the plot rely on them knowing?",
      "Would a stranger recognise them from your notes alone?",
    ],
  },
  8: {
    rule: "List every scene: POV, what happens in one line, and an estimated length. Sort them into chapters. This list is the story's blueprint.",
    examples: [
      {
        source: "Cinderella",
        text: "POV: Cinderella — The invitation arrives and she is told to clean the fireplace instead (~800 words).",
      },
      {
        source: "Pride and Prejudice",
        text: "POV: Elizabeth — The first proposal: Darcy declares himself and is refused in a scene the reader has been waiting two acts for (~2,200 words).",
      },
      {
        source: "Frankenstein",
        text: "POV: Victor — The creature finishes its narrative and makes its demand; the fire has burned low (~1,900 words).",
      },
    ],
    questions: [
      "Which scene are you most excited to write?",
      "Which chapter runs long — and what moves out of it?",
      "Do POV switches cluster, or rotate scene by scene?",
      "Where does a scene exist only because the plot needs it?",
      "Does any disaster land in the wrong quarter?",
    ],
  },
  9: {
    rule: "Expand each scene's one-liner into a multi-paragraph synopsis: what happens, what changes, and how the POV character ends it different than they began.",
    examples: [
      {
        source: "Cinderella",
        text: "The midnight flight expands to: the chime, the panic, the lost slipper, the carriage unravelling into gourds on the road home, and the one glass shoe left on the stairs.",
      },
      {
        source: "Pride and Prejudice",
        text: "The refusal scene expands to: the botched proposal speech, Elizabeth's catalogue of grievances, Darcy's shock, and the two exits that leave both of them rethinking everything.",
      },
      {
        source: "Frankenstein",
        text: "The creation night expands to: the spark of life, the yellow eye opening, the recoil, the flight to bed, the dream of Elizabeth turning to a corpse, and the creature standing over him when he wakes.",
      },
    ],
    questions: [
      "Does the synopsis deliver the disaster the step-8 line promised?",
      "What does the POV character want entering this scene?",
      "What changes by the last paragraph?",
      "Which scenes almost write themselves — and which fight you?",
      "Ready to open the next scene and draft it?",
    ],
  },
};
