// The standard clock. One tick is one hour. These are the simulation's own units of measure, like SI units: ages,
// the weekly fold, the speed ladder, the global clock and chart axes all count in them.
//
// They are NOT any planet's calendar. A planet's day and year come from its own spin and orbit (`BodyMeta.dayLength`,
// `period`) and drive light, local time and seasons; never use these to mean "a day here". Call them "standard".
export const HOUR = 1;
export const DAY = 24 * HOUR; // standard day
export const WEEK = 7 * DAY;
export const MONTH = 30 * DAY; // a round number for speeds and spans; the sim has no months
export const YEAR = 8760 * HOUR; // standard year, 365 standard days
