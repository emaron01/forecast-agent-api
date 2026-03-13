const fs = require("fs");
const path = "web/components/dashboard/executive/ExecutiveGapInsightsClient.tsx";
const lines = fs.readFileSync(path, "utf8").split(/\r?\n/);
const heroLines = lines.slice(2433, 2677);
const heroContent = heroLines.join("\n");
const closingDiv = "    </div>";
const fullContent = [
  "  }",
  "",
  "  if (props.heroOnly) {",
  "    return (",
  "      <>",
  heroContent,
  closingDiv,
  "      </>",
  "    );",
  "  }",
  "",
  "  if (props.revenueTabOnly) {",
].join("\n");
fs.writeFileSync("hero_new_block.txt", fullContent, "utf8");
