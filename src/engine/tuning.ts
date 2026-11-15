/** Every tunable number the engine uses. Change balance here, nowhere else. */
export const TUNING = {
  credibility: {
    start: 70,
    min: 0,
    max: 100,
    /** Applied to the side that raised an objection the judge overruled. */
    overruledObjection: -8,
    /** Applied to the side whose question was struck after a sustained objection. */
    sustainedObjection: -5,
    unsupportedClaim: -6,
    contradictedClaim: -10,
  },
  jury: {
    /** Below this credibility a side's favourable jury deltas are halved toward zero. */
    lowCredibility: 40,
    maxDelta: 2,
    leanMin: -10,
    leanMax: 10,
    /** Not guilty / guilty votes needed for a verdict; otherwise hung. */
    votesForVerdict: 4,
  },
  limits: {
    maxQuestionChars: 1500,
    maxStatementChars: 8000,
  },
} as const;
