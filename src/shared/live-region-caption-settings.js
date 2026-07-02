export const DEFAULT_LIVE_REGION_CAPTION_SETTINGS = {
  autoHide: false,
  autoHideSeconds: 6,
  position: "bottom",
  textSize: "medium",
  textColor: "#ffffff",
  backgroundColor: "#0a0f19",
  backgroundOpacity: 94
};

const VALID_POSITIONS = new Set(["top", "bottom"]);
const VALID_TEXT_SIZES = new Set(["small", "medium", "large", "extra-large"]);

export function normalizeLiveRegionCaptionSettings(settings = {}) {
  const autoHideSeconds = Number(settings.autoHideSeconds);
  const backgroundOpacity = Number(settings.backgroundOpacity);

  return {
    autoHide: Boolean(settings.autoHide),
    autoHideSeconds: Number.isFinite(autoHideSeconds)
      ? Math.min(30, Math.max(1, Math.round(autoHideSeconds)))
      : DEFAULT_LIVE_REGION_CAPTION_SETTINGS.autoHideSeconds,
    position: VALID_POSITIONS.has(settings.position)
      ? settings.position
      : DEFAULT_LIVE_REGION_CAPTION_SETTINGS.position,
    textSize: VALID_TEXT_SIZES.has(settings.textSize)
      ? settings.textSize
      : DEFAULT_LIVE_REGION_CAPTION_SETTINGS.textSize,
    textColor: isHexColor(settings.textColor)
      ? settings.textColor
      : DEFAULT_LIVE_REGION_CAPTION_SETTINGS.textColor,
    backgroundColor: isHexColor(settings.backgroundColor)
      ? settings.backgroundColor
      : DEFAULT_LIVE_REGION_CAPTION_SETTINGS.backgroundColor,
    backgroundOpacity: Number.isFinite(backgroundOpacity)
      ? Math.min(100, Math.max(0, Math.round(backgroundOpacity)))
      : DEFAULT_LIVE_REGION_CAPTION_SETTINGS.backgroundOpacity
  };
}

function isHexColor(value) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}
