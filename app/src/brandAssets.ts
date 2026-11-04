const logos = import.meta.glob("./assets/logo.{png,jpg,jpeg,svg,webp}", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

export const logoUrl = Object.values(logos)[0];

const communityLogos = import.meta.glob(
  "./assets/community-logo.{png,jpg,jpeg,svg,webp}",
  { eager: true, query: "?url", import: "default" },
) as Record<string, string>;

export const communityLogoUrl = Object.values(communityLogos)[0];
