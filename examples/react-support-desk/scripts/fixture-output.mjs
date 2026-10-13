export function fixtureOutput(input) {
  if (
    typeof input.message !== "string" ||
    Object.keys(input).some((key) => key !== "message")
  )
    throw new Error("Unexpected provider input");
  return {
    summary: `[TEST FIXTURE — no AI inference] ${input.message.split(/[.!?]/)[0].slice(0, 160)}.`,
    sentiment: "neutral",
  };
}
