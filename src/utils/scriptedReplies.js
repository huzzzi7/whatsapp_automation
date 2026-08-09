/**
 * Exact wording for the Message 2 script's deterministic outcomes (different-uni link, ticket
 * link, not-interested). Shared by the button-driven reply sequence and the AI free-text pipeline
 * so both produce the same script text regardless of which path a student's reply takes.
 */
const ASK_WHICH_UNIVERSITY_TEXT = 'Which university are you going to?';
const NOT_INTERESTED_TEXT =
  "No problem, if you need anything related to your university Freshers' Week, let us know 🙂";
const UNIVERSITY_LINK_NOT_FOUND_TEXT = "Thanks — we'll find that group for you and follow up shortly.";
const INTERESTED_NO_LINK_TEXT = "Let us know and we'll send you the link to buy your official freshers week tickets.";

function universityLinkFoundText(link) {
  return `Here's the link ${link} for you to join, if you need anything else let us know.`;
}

function interestedText(link) {
  return `Buy the official freshers week tickets for your university here ${link}`;
}

module.exports = {
  ASK_WHICH_UNIVERSITY_TEXT,
  NOT_INTERESTED_TEXT,
  UNIVERSITY_LINK_NOT_FOUND_TEXT,
  INTERESTED_NO_LINK_TEXT,
  universityLinkFoundText,
  interestedText,
};
