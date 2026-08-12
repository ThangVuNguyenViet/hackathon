export interface PvcfcDemoScenario {
  readonly id: string;
  readonly title: string;
  readonly turns: readonly string[];
  readonly evidenceMode: "provider" | "provider_then_live_web";
}

export const PVCFC_SUGGESTION_PILLS: readonly string[] = Object.freeze([
  "Tra cứu sản phẩm và dẫn nguồn chính thức",
  "So sánh sản phẩm kèm trích dẫn",
  "Tìm chứng nhận, tài liệu và URL nguồn",
  "Tra cứu đại lý, dẫn nguồn và ngày cập nhật",
  "Tin PVCFC mới nhất, dẫn nguồn (cần web trực tiếp)",
  "Danh mục chính thức, dẫn nguồn (cần web trực tiếp)",
]);

export const PVCFC_DEMO_SCENARIOS: readonly PvcfcDemoScenario[] = Object.freeze(
  [
    Object.freeze({
      id: "exact-product",
      title: "Tra cứu đúng sản phẩm",
      evidenceMode: "provider",
      turns: Object.freeze([
        "Tra cứu NPK Cà Mau Gold 20-20-15 trong 67 hồ sơ sản phẩm và dẫn URL nguồn chính thức.",
        "Tóm tắt đúng thành phần, công dụng và quy cách theo hồ sơ tìm được. Nếu nguồn không nêu giá hoặc tồn kho, hãy nói rõ là chưa có dữ liệu và không suy đoán.",
      ]),
    }),
    Object.freeze({
      id: "product-comparison",
      title: "So sánh hai sản phẩm",
      evidenceMode: "provider",
      turns: Object.freeze([
        "So sánh N46.PLUS Cà Mau và N46.TRUE trong 67 hồ sơ sản phẩm chính thức; trích dẫn URL nguồn cho từng điểm khác biệt.",
        "Chỉ kết luận những gì nguồn PVCFC thể hiện. Nếu thiếu thuộc tính để so sánh, hãy nêu phần còn thiếu thay vì tự bổ sung.",
      ]),
    }),
    Object.freeze({
      id: "certificate-traceability",
      title: "Truy vết chứng thư",
      evidenceMode: "provider",
      turns: Object.freeze([
        "Trong 249 hồ sơ chứng nhận và tài liệu, tìm Chứng thư chất lượng 0383/2026/SP; nêu thông tin nhận diện và dẫn URL nguồn chính thức.",
        "Nếu có tệp tài liệu gốc, hãy chỉ ra liên kết tương ứng và phân biệt dữ liệu trên hồ sơ với điều chưa được nguồn xác nhận.",
      ]),
    }),
    Object.freeze({
      id: "dealer-contact-freshness",
      title: "Đại lý và độ mới dữ liệu",
      evidenceMode: "provider",
      turns: Object.freeze([
        "Trong 18 hồ sơ đại lý và liên hệ, tra cứu Cửa hàng phân bón Khánh My tại Xã Hòa Bình, Tỉnh Cà Mau; dẫn URL nguồn và ngày nguồn hoặc ngày thu thập nếu có.",
        "Nêu rõ dữ liệu liên hệ có thể thay đổi và chưa thể xác nhận giờ hoạt động nếu nguồn không công bố.",
      ]),
    }),
    Object.freeze({
      id: "urban-agriculture",
      title: "Nông nghiệp đô thị 2Nông",
      evidenceMode: "provider",
      turns: Object.freeze([
        "Tóm tắt các sản phẩm, dịch vụ hoặc giải pháp 2Nông/Nông nghiệp đô thị trong 15 hồ sơ và dẫn URL nguồn chính thức cho từng nhóm.",
        "Phân biệt nội dung giới thiệu chính thức với hướng dẫn kỹ thuật; không đưa liều dùng chính xác nếu hồ sơ nguồn không có bằng chứng.",
      ]),
    }),
    Object.freeze({
      id: "corporate-facilities",
      title: "Nhà máy và cơ sở PVCFC",
      evidenceMode: "provider",
      turns: Object.freeze([
        "Từ 7 hồ sơ doanh nghiệp và cơ sở, liệt kê các nhà máy hoặc trung tâm của PVCFC và dẫn URL nguồn chính thức cho từng địa điểm.",
        "Cho biết hồ sơ nào mô tả dấu chân sản xuất chung, hồ sơ nào là một cơ sở cụ thể; không suy đoán địa chỉ còn thiếu.",
      ]),
    }),
    Object.freeze({
      id: "public-reports",
      title: "Báo cáo công khai",
      evidenceMode: "provider",
      turns: Object.freeze([
        "Liệt kê 3 báo cáo công khai trong dữ liệu PVCFC, phân loại báo cáo thường niên và phát triển bền vững, rồi dẫn URL nguồn hoặc tài liệu gốc.",
        "Nêu năm báo cáo đúng như hồ sơ và không suy diễn chỉ tiêu tài chính hay ESG chưa được trích từ nguồn.",
      ]),
    }),
    Object.freeze({
      id: "current-official-news",
      title: "Tin chính thức mới nhất",
      evidenceMode: "provider_then_live_web",
      turns: Object.freeze([
        "Tìm tin PVCFC mới nhất: tra cứu dữ liệu nhà cung cấp trước, sau đó dùng web trực tiếp khi cần; dẫn URL nguồn bài chính thức và ngày đăng. Kịch bản này cần TinyFish được cấu hình.",
        "Chỉ dùng các miền PVCFC được phép, mở bài nguồn để kiểm tra nội dung và nói rõ đâu là bằng chứng web hiện thời.",
      ]),
    }),
    Object.freeze({
      id: "current-official-catalogue",
      title: "Danh mục chính thức hiện hành",
      evidenceMode: "provider_then_live_web",
      turns: Object.freeze([
        "Kiểm tra danh mục sản phẩm và dịch vụ PVCFC đang công bố: tra cứu nhà cung cấp trước, rồi tải trang chính thức đã được kiểm kê hoặc được tìm thấy trong lượt này. Dẫn URL nguồn; kịch bản này cần TinyFish được cấu hình.",
        "So sánh trang web vừa kiểm tra với hồ sơ sản phẩm hiện có, ghi rõ điểm nào là bằng chứng web hiện thời và không biến dữ liệu web thành dữ liệu nhà cung cấp.",
      ]),
    }),
  ],
);
