export function trimConversationHistory(messages, maxHistory = 20) {
  const safeMessages = Array.isArray(messages) ? messages : [];
  const safeLimit = Number.isInteger(maxHistory) && maxHistory > 0 ? maxHistory : 20;
  let trimmed = safeMessages.slice(-safeLimit);
  if (trimmed[0]?.role === 'assistant') trimmed = trimmed.slice(1);
  return trimmed;
}
