export const addHours = (date, hours) => new Date(new Date(date).getTime() + hours * 60 * 60 * 1000);
export const iso = (date = new Date()) => new Date(date).toISOString();
