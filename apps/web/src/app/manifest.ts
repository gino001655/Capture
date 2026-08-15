import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Personal Capture",
    short_name: "Capture",
    description: "Capture now, process locally, and keep the result moving.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f3f0e8",
    theme_color: "#247554",
    icons: [
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
