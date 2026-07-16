import path from "path";

/** Session storage written by auth.setup / read by smoke-* projects. */
export const authStorageStatePath = path.join(__dirname, "..", ".auth", "user.json");
