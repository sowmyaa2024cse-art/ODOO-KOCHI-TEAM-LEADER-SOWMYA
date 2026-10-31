export interface Clock {
  now(): Date;
  after(milliseconds: number): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
  after: (milliseconds) => new Date(Date.now() + milliseconds),
};

export function fixedClock(instant: Date): Clock {
  const timestamp = instant.getTime();

  return {
    now: () => new Date(timestamp),
    after: (milliseconds) => new Date(timestamp + milliseconds),
  };
}
