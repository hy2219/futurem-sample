import { renderToStaticMarkup } from "react-dom/server";
import ChangeBoardPage from "./page.js";

test("board starts with approved UI, separate asset navigation and an explicit loading state", () => {
  const html = renderToStaticMarkup(<ChangeBoardPage />);
  expect(html).toContain("변경 점검 보드");
  expect(html).toContain("변경 정보를 조회하는 중");
  expect(html).toContain('href="/"');
  expect(html).toContain('data-custom-ui-version="0.2.0"');
  expect(html).not.toContain("0건");
});
