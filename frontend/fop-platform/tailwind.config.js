module.exports = {
  content: ["./app/**/*.{js,jsx}", "./components/**/*.{js,jsx}"],
  theme: { extend: {
    colors: { ink: "#1C2230", paper: "#F5F6F4", line: "#E3E5E0", brand: { DEFAULT: "#0E6B5C", soft: "#E4F1EE" } },
    fontFamily: { sans: ["var(--font-onest)", "system-ui", "sans-serif"] } } },
};
