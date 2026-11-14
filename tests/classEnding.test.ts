import { describe, it, expect } from 'vitest'
import { isClassEnding, endingNotice } from '../src/live/classEnding'

describe('isClassEnding: the teacher is wrapping up', () => {
  it.each([
    "That's all for today.",
    'that is it for today',
    "OK, that's it for today, thanks everyone",
    "We'll stop here.",
    "Let's stop there for today",
    'See you next week!',
    'see you on Thursday',
    'See you all tomorrow',
    'Class dismissed.',
    "We're out of time",
    "We're done for today",
    'For homework, do problems 3 to 7.',
    'Your homework is the next worksheet',
    'Have a good weekend everyone',
  ])('ending: %s', text => expect(isClassEnding(text)).toBe(true))

  it.each([
    'This cancels with that.',
    "Today we're learning fractions", // "today" alone is not an ending
    'Let me see what you got', // "see" alone is not an ending
    'Stop me if this is unclear', // "stop" alone is not an ending
    "That's all there is to this step",
    '',
  ])('not ending: %s', text => expect(isClassEnding(text)).toBe(false))
})

describe('endingNotice', () => {
  it('names the moment and repeats what the teacher said, since it often holds the homework', () => {
    expect(endingNotice('For homework, do problems 3 to 7.')).toBe('Class is wrapping up. The teacher said: For homework, do problems 3 to 7.')
  })
})
