import { nanoid } from "nanoid";
export const id = (len = 8) => nanoid(len).toUpperCase();
