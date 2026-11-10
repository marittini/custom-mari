// Prompts of the "번역 프리셋·단어장" extension (v1.6.4) for its three automatic notes, as kept in ME-personal
// (packages/server/src/services/native-integrations.ts). {{target}} is the translation target language.

export const TRANSLATION_SCAN_PROMPTS = Object.freeze({
  glossary: `You compile a fixed-rendering list so that a {{target}} translation of this roleplay keeps every proper noun and invented term consistent.
Read the character cards, the user's persona, the linked lorebooks and the recent messages.
Reply with JSON only: {"glossary":[{"original":"","translation":""}]}

Include the names of people, places, groups and institutions, titles and ranks, named objects, and words the story itself made up.
"original" is the term exactly as it appears in the material. "translation" is the one form a {{target}} reader should always see.
Write foreign names the way {{target}} normally writes them, and keep any {{target}} form the material already uses.
List each person once, under the fullest form of the name. Do not add separate entries for a given name, a surname or another piece of a name that is already listed; a nickname gets its own entry only when it is not part of the full name.
Only list terms that are names in their own right. Leave out possessive or descriptive phrases built from a name, generic places and objects, everyday vocabulary, and anything already written in {{target}}. At most 40 entries.`,
  speech: `You write voice notes that let a translator reproduce each character's way of speaking in natural spoken {{target}}.
Read each character card (description, personality, scenario, first message, example dialogue), the user's persona, the linked lorebooks and the recent messages.
Reply with JSON only: {"characters":[{"character":"","age":"","relations":"","speech":"","samples":[]}]}

One entry for every person who speaks or may speak: the main characters, the user's persona, and the NPCs described in the lorebooks or appearing in the story (at most 20 entries; main characters and the persona first).
"character" is the name exactly as written in the story.
"age" is the stated age, or a short estimate written in {{target}}; leave it empty when nothing hints at it.
"relations" is written in {{target}}: how this person relates to the user's persona and to the other main characters, as "name: relationship" pairs separated by "; ".
"speech" is written in {{target}}: 4–7 lines, each starting with "- ", giving concrete rules instead of adjectives:
- the speech level used toward each listener, quoting the actual sentence endings to use in {{target}};
- written or stiff endings to keep out of their dialogue, unless the character really speaks that way;
- the first-person form, and how they address each person (name forms, titles, kinship terms, nicknames), including when the second-person pronoun should be left out rather than translated literally;
- sentence length and rhythm, interjections, fillers, trailing off, slang or dialect;
- how their endings, politeness and address change when angry, flustered, teasing or affectionate.
"samples" is a list of 2 short lines of dialogue written in {{target}}, in that character's exact voice as it would sound in this story.
Base every point on the material. Call the user by the persona's name, never {{user}} or {{char}}.`,
  world: `You write setting notes for a translator who will translate this story into {{target}}.
Read the character cards, the user's persona and the linked lorebooks, and describe the world the story takes place in.
Keep only what helps choose vocabulary, register and terminology:
- genre, tone and atmosphere;
- era, level of technology, region, and the real-world culture it resembles, if any;
- places, organizations, ranks, titles and forms of address used in this world;
- invented terms, magic or technology systems, currencies and units, each with a one-line meaning;
- social order that affects how people speak to one another.
Leave out plot events, personal histories, personalities and how individual characters talk.
Write in {{target}} as short plain lines grouped under brief headings, at most 1500 characters in total, without JSON, code blocks or closing remarks.
Base every line on the material. If the material says nothing about the world, reply with nothing.`,
});
