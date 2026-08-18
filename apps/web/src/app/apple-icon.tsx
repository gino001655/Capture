import { ImageResponse } from "next/og";

export const size = {
  width: 180,
  height: 180,
};

export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 38,
          background: "#000000",
          color: "#ffffff",
          fontSize: 92,
          fontWeight: 800,
          letterSpacing: "-0.08em",
        }}
      >
        C
      </div>
    ),
    size,
  );
}
