export const links = {
  website: process.env.AAOC_WEBSITE_URL || "https://aaocvirtual.com",
  training: process.env.AAOC_TRAINING_URL || "https://aaocvirtual.com",
  vatsim: "https://vatsim.net",
  simbrief: "https://dispatch.simbrief.com"
};

// Replace/add entries as AAOC standardization is finalized.
export const callsigns = {
  training: "AAOC",
  command: "AAOC",
  mobility: "AAOC",
  fighter: "AAOC"
};
