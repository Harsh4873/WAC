export const DEFAULT_PROFILE = Object.freeze({
  fieldOfStudy: '',
  stage: 'unspecified',
  familiarTopics: '',
  developingTopics: '',
  readingPace: 'typical',
  writingConfidence: 'some',
  preferredBlockMinutes: 45,
});
export function validateProfile(input = {}) {
  const profile = { ...DEFAULT_PROFILE };
  for (const [key, max] of [
    ['fieldOfStudy', 160],
    ['familiarTopics', 1500],
    ['developingTopics', 1500],
  ]) {
    const text = String(input[key] || '').trim();
    if (text.length > max)
      throw new Error(
        `Please shorten ${key === 'fieldOfStudy' ? 'your study or work area' : 'your topic list'}.`,
      );
    profile[key] = text;
  }
  for (const [key, allowed] of [
    ['stage', ['unspecified', 'school', 'undergraduate', 'graduate', 'professional', 'other']],
    ['readingPace', ['slower', 'typical', 'faster']],
    ['writingConfidence', ['new', 'some', 'familiar']],
  ]) {
    const value = input[key] ?? DEFAULT_PROFILE[key];
    if (!allowed.includes(value)) throw new Error(`Choose a valid ${key} option.`);
    profile[key] = value;
  }
  const minutes = Number(input.preferredBlockMinutes ?? 45);
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 240)
    throw new Error('Choose a focus block between 5 and 240 minutes.');
  profile.preferredBlockMinutes = minutes;
  return profile;
}
export function profileFactor(type, profile) {
  if (!profile) return 1;
  if (type === 'reading')
    return { slower: 1.2, typical: 1, faster: 0.85 }[profile.readingPace] ?? 1;
  if (type === 'writing')
    return { new: 1.2, some: 1, familiar: 0.85 }[profile.writingConfidence] ?? 1;
  return 1;
}
