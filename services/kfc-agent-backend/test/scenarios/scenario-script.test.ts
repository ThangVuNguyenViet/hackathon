import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadScenarioScript } from '../../src/scenarios/scenarioScript.js';

function hasUnsupportedAdvisoryClaim(text: string): boolean {
  const normalizedClauses = text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .split(/[.!?\n;,]+|\b(?:nhung|tuy nhien)\b/gu)
    .map((clause) => clause.trim())
    .filter(Boolean);
  const uncertaintyQualifier =
    /(?:khong|chua) co thong tin|menu (?:khong|chua)|khong noi ro|chua ro|khong ro|khong the ket luan/u;
  const unsupportedClaimPatterns = [
    /health(?:y|ier)?|lanh manh|tot cho suc khoe/u,
    /more filling|no lau|no hon/u,
    /(?:du|phu hop)(?:\s+\S+){0,6}\s+(?:cho\s+)?\d+\s*nguoi/u,
    /burger zinger[^\n]{0,40}(?:chac chan cay|cay hon|la mon cay)/u,
  ];

  return normalizedClauses.some(
    (clause) =>
      !uncertaintyQualifier.test(clause) &&
      unsupportedClaimPatterns.some((pattern) => pattern.test(clause)),
  );
}

describe('loadScenarioScript', () => {
  it('loads metadata, turns, and expectations from scenario JSON', async () => {
    const script = await loadScenarioScript(
      join(
        process.cwd(),
        '../../ai-talent-tracks/fnb/conversations/08-thanh-toan-loi-va-don-bat-thuong.json',
      ),
    );

    expect(script.id).toBe('08-thanh-toan-loi-va-don-bat-thuong');
    expect(script.channel).toBe('kfc');
    expect(script.finalState).toBe('human_review_required');
    expect(script.useCases).toEqual(['UC-18', 'UC-39']);
    expect(script.userTurns).toHaveLength(4);
    expect(script.turns.some((turn) => turn.useCases.includes('Filler'))).toBe(
      true,
    );
    expect(script.expectations).toContain(
      'Đơn số lượng rất lớn kích hoạt `human_review_required`.',
    );
  });

  it('loads the grounded comparison and non-spicy recommendation scenario', async () => {
    const comparison = await loadScenarioScript(
      join(
        process.cwd(),
        '../../ai-talent-tracks/fnb/conversations/10-so-sanh-mon-va-giai-thich.json',
      ),
    );

    const botTurns = comparison.turns
      .filter(({ speaker }) => speaker === 'Bot')
      .map(({ text }) => text);
    const [comparisonAnswer, recommendationAnswer] = botTurns;
    const allBotText = botTurns.join('\n');

    expect(comparison.finalState).toBe('advisory_complete');
    expect(comparison.userTurns).toHaveLength(2);
    expect(botTurns).toHaveLength(2);
    expect(comparisonAnswer).toMatch(/20698.*79\.000đ/);
    expect(comparisonAnswer).toMatch(
      /Burger [Zz]inger.*Khoai tây chiên.*Pepsi/,
    );
    expect(comparisonAnswer).toMatch(/20709.*85\.000đ/);
    expect(comparisonAnswer).toMatch(
      /Gà Rán.*Gà Lắc Tiêu Chanh.*Pepsi Không Đường/,
    );
    expect(comparisonAnswer).toContain('đắt hơn 6.000đ');
    expect(comparisonAnswer).not.toMatch(
      /dữ liệu|đã xác minh|85\.000đ\s*-\s*79\.000đ/i,
    );
    expect(recommendationAnswer).toMatch(/(?:khuyên|phù hợp).*20709/i);
    expect(recommendationAnswer).toContain('Gà Giòn Không Cay');
    expect(recommendationAnswer).toContain('Gà Truyền Thống');
    expect(recommendationAnswer).toContain('Gà Lắc Tiêu Chanh');
    expect(recommendationAnswer).toMatch(
      /chưa có thông tin rõ|chưa rõ|không chắc|không có thông tin/i,
    );
    expect(recommendationAnswer).not.toMatch(
      /dữ liệu|đã xác minh|thang độ cay/i,
    );
    expect(allBotText).not.toMatch(/đã (?:thêm|đổi|cập nhật).*giỏ/i);
    expect(hasUnsupportedAdvisoryClaim(allBotText)).toBe(false);
  });

  it('detects unsupported advisory claims without rejecting uncertainty-only language', () => {
    expect(hasUnsupportedAdvisoryClaim('Combo này đủ cho 2 người.')).toBe(true);
    expect(hasUnsupportedAdvisoryClaim('Đủ cho 2 người.')).toBe(true);
    expect(
      hasUnsupportedAdvisoryClaim(
        'Chưa rõ dữ liệu, nhưng combo 20709 tốt cho sức khỏe hơn.',
      ),
    ).toBe(true);
    expect(
      hasUnsupportedAdvisoryClaim(
        'Menu không nói rõ combo nào tốt cho sức khỏe hơn.',
      ),
    ).toBe(false);
  });

  it('loads the preference-first and allergy-safe advisory scenario', async () => {
    const allergy = await loadScenarioScript(
      join(
        process.cwd(),
        '../../ai-talent-tracks/fnb/conversations/11-khau-vi-va-di-ung.json',
      ),
    );

    const botTurns = allergy.turns
      .filter(({ speaker }) => speaker === 'Bot')
      .map(({ text }) => text);
    const [preferenceAnswer, allergyAnswer] = botTurns;
    const allBotText = botTurns.join('\n');

    expect(allergy.finalState).toBe('safety_escalation');
    expect(allergy.userTurns).toHaveLength(2);
    expect(botTurns).toHaveLength(2);
    expect(preferenceAnswer).toContain('Burger Gà Yo');
    expect(preferenceAnswer).toContain('không cay');
    expect(preferenceAnswer).toContain('Burger Phi-lê Gà Quay');
    expect(preferenceAnswer).toMatch(/bạn có thể.*không chọn.*phô mai/i);
    expect(preferenceAnswer).not.toMatch(
      /mình sẽ.*(?:để nguyên|không thêm).*phô mai/i,
    );
    expect(preferenceAnswer).not.toMatch(
      /60258|70444|60259|70049|default false|số lượng 0/i,
    );
    expect(allergyAnswer).toMatch(/không thể (?:khẳng định|đảm bảo).*an toàn/i);
    expect(allergyAnswer).toMatch(
      /không thêm phô mai.*không có nghĩa.*không chứa sữa/i,
    );
    expect(allergyAnswer).toContain('thông tin dị ứng chính thức của KFC');
    expect(allergyAnswer).toContain('nhân viên cửa hàng');
    expect(allergyAnswer).not.toMatch(
      /60258|70444|60259|70049|cấp món|modifier/i,
    );
    expect(allergyAnswer).not.toMatch(/(?:cheese|dairy|milk)[ -]?free/i);
    expect(allergyAnswer).not.toMatch(
      /chắc chắn an toàn|hoàn toàn an toàn|an toàn để (?:ăn|dùng)|bạn có thể yên tâm/i,
    );
    expect(allBotText).not.toMatch(/đã (?:thêm|đổi|cập nhật).*giỏ/i);
  });

  it('loads the combo conversion and accepted upsize contract', async () => {
    const script = await loadScenarioScript(
      join(
        process.cwd(),
        '../../ai-talent-tracks/fnb/conversations/02-tu-van-combo-va-upsell.json',
      ),
    );

    expect(script.finalState).toBe('cart_ready');
    expect(script.userTurns).toHaveLength(5);
    expect(script.userTurns.map((turn) => turn.text)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('10 miếng gà'),
        expect.stringContaining('đổi sang 2 Combo Đẫy Đà 129K'),
        expect.stringContaining('nâng cả 4 Pepsi lên size đại'),
      ]),
    );
    expect(script.expectations).toEqual(
      expect.arrayContaining([
        expect.stringContaining('404.000đ - 258.000đ = 146.000đ'),
        expect.stringContaining('258.000đ + 28.000đ = 286.000đ'),
        expect.stringContaining('không tự đổi'),
        expect.stringContaining('không tự nâng size'),
        expect.stringContaining('đồng ý rõ ràng'),
      ]),
    );
    expect(script.acceptance).toEqual({
      noCartMutationBeforeUserTurn: 5,
      cartAfterUserTurn: {
        '5': {
          includedItems: [
            { itemCode: '41037', quantity: 3 },
            { itemCode: '41035', quantity: 1 },
            { itemCode: '41074', quantity: 4 },
          ],
          totalVnd: 404000,
        },
      },
      assistantAfterUserTurnContains: {
        '5': ['2 Combo Đẫy Đà 129K', '146.000'],
      },
      finalCart: {
        includedItems: [
          { itemCode: '20752', quantity: 2, unitPriceVnd: 143000 },
        ],
        excludedItemCodes: ['41037', '41035', '41074'],
        totalVnd: 286000,
      },
    });
  });

  it('separates verified item unavailability from unverified delivery coverage', async () => {
    const script = await loadScenarioScript(
      join(
        process.cwd(),
        '../../ai-talent-tracks/fnb/conversations/03-ton-kho-dia-chi-va-cua-hang.json',
      ),
    );

    const unavailableAnswer = script.turns[1]?.text;

    expect(unavailableAnswer).toContain('Burger Tôm');
    expect(unavailableAnswer).toMatch(/tạm hết|tạm thời chưa có/i);
    expect(unavailableAnswer).toMatch(/địa chỉ cụ thể|địa chỉ chính xác/i);
    expect(unavailableAnswer).toMatch(/kiểm tra.*giao/i);
    expect(unavailableAnswer).toMatch(
      /cửa hàng khác|món khác|Burger Gà Zinger/i,
    );
    expect(unavailableAnswer).not.toMatch(
      /41140|đã xác minh|lượt kiểm tra|tồn kho/i,
    );
  });

  it('treats scenario 06 dietary wording as an ordinary preference', async () => {
    const script = await loadScenarioScript(
      join(
        process.cwd(),
        '../../ai-talent-tracks/fnb/conversations/06-ngon-ngu-tu-nhien-va-an-toan.json',
      ),
    );

    const preferenceAnswer = script.turns[3]?.text;

    expect(script.userTurns[1]?.text).toContain('không cay');
    expect(script.userTurns[1]?.text).toContain('không thêm phô mai');
    expect(script.userTurns[1]?.text).not.toMatch(/dị ứng|allerg/i);
    expect(preferenceAnswer).toContain('không cay');
    expect(preferenceAnswer).toContain('không thêm phô mai');
    expect(preferenceAnswer).toMatch(/gà rán|burger/i);
    expect(preferenceAnswer).toMatch(/bạn muốn|bạn thích/i);
    expect(preferenceAnswer).not.toMatch(
      /dị ứng|allerg|đã xác minh|sở thích thông thường|suy diễn|trạng thái chưa chọn|an toàn y khoa|(?:chỉ|đang)\s+(?:là\s+)?tư vấn|chưa\s+(?:thêm|thay đổi|cập nhật).*giỏ/i,
    );
  });

  it('keeps legacy scenario replies natural while preserving their outcomes', async () => {
    const conversationDir = join(
      process.cwd(),
      '../../ai-talent-tracks/fnb/conversations',
    );
    const [
      checkout,
      tracking,
      complaint,
      loyalty,
      paymentFailure,
      paymentMethods,
    ] = await Promise.all(
      [
        '01-dat-mon-ro-rang-giao-hang.json',
        '04-sau-khi-dat-don.json',
        '05-khieu-nai-va-human-handoff.json',
        '07-ca-nhan-hoa-va-loyalty.json',
        '08-thanh-toan-loi-va-don-bat-thuong.json',
        '09-phuong-thuc-thanh-toan.json',
      ].map((fileName) => loadScenarioScript(join(conversationDir, fileName))),
    );

    expect(checkout.turns[7]?.text).toMatch(
      /ZaloPay.*(?:thanh toán|xác nhận đơn)/i,
    );
    expect(checkout.turns[11]?.text).toMatch(/mã đơn/i);
    expect(checkout.turns[11]?.text).not.toMatch(/MOCK|Order ID/i);
    expect(tracking.turns[3]?.text).toMatch(/vẫn.*chuẩn bị|chưa thay đổi/i);
    expect(complaint.turns[9]?.text).toMatch(
      /gà ngon.*giao (?:chậm|lâu).*(?:sai món|món bị giao sai)/i,
    );
    expect(loyalty.turns[5]?.text).toMatch(/3\.200 điểm/i);
    expect(loyalty.turns[5]?.text).toMatch(/30 ngày.*chưa có giao dịch/i);
    expect(loyalty.turns[5]?.text).toMatch(/Mã Giảm 10k.*3\.000 điểm/i);
    expect(loyalty.turns[5]?.text).toMatch(/đơn từ 50\.000đ/i);
    expect(loyalty.turns[5]?.text).toMatch(/quầy.*kiosk.*Zalo Miniapp/i);
    expect(loyalty.userTurns[3]?.text).toContain(
      'Mình muốn đổi 3.000 điểm lấy Mã Giảm 10k, nhưng chưa xác nhận đổi.',
    );
    expect(loyalty.turns[7]?.text).toMatch(/chưa đổi.*chưa xác nhận/i);
    expect(loyalty.userTurns[4]?.text).toContain(
      'Mình xác nhận đổi Mã Giảm 10k',
    );
    expect(loyalty.userTurns[4]?.text).toContain('Ưu Đãi Chào Bạn Mới');
    expect(loyalty.turns[9]?.text).toMatch(/đã đổi Mã Giảm 10k/i);
    expect(loyalty.turns[9]?.text).not.toMatch(/còn 200 điểm|số dư.*200/i);
    expect(loyalty.turns[9]?.text).toMatch(/Ưu Đãi Chào Bạn Mới/i);
    expect(loyalty.turns[9]?.text).toMatch(/chưa đặt món|chưa tạo đơn/i);
    expect(paymentFailure.turns[3]?.text).toMatch(
      /chưa thành công|chưa hoàn tất/i,
    );
    expect(paymentFailure.turns[7]?.text).toMatch(/200 combo.*nhân viên/i);
    expect(paymentFailure.turns[7]?.text).not.toMatch(
      /đơn ảo|bất thường|gian lận|policy/i,
    );
    expect(paymentMethods.turns[1]?.text).toMatch(
      /thanh toán khi nhận hàng.*ZaloPay/i,
    );
    expect(paymentMethods.turns[3]?.text).toMatch(
      /chưa thấy MoMo.*phương thức thanh toán.*công bố.*website hoặc ứng dụng KFC/i,
    );
    expect(paymentMethods.turns[3]?.text).not.toMatch(
      /KFC chưa hỗ trợ thanh toán bằng MoMo/i,
    );
  });

  it('rejects evaluator and fixture terminology in every Bot turn', async () => {
    const conversationDir = join(
      process.cwd(),
      '../../ai-talent-tracks/fnb/conversations',
    );
    const fileNames = (await readdir(conversationDir)).filter((fileName) =>
      fileName.endsWith('.json'),
    );
    const scripts = await Promise.all(
      fileNames.map((fileName) =>
        loadScenarioScript(join(conversationDir, fileName)),
      ),
    );
    const botText = scripts
      .flatMap((script) =>
        script.turns
          .filter(({ speaker }) => speaker === 'Bot')
          .map(({ text }) => `${script.id}: ${text}`),
      )
      .join('\n');

    expect(botText).not.toMatch(
      /KFC-MOCK|Order ID|default false|số lượng 0|nhóm lựa chọn bắt buộc 6\d+|phương án 7\d+|không suy diễn thành dị ứng|sở thích thông thường|lượt kiểm tra tồn kho này|commerce mutation|dữ liệu đã xác minh|theo chính sách thanh toán công khai|checkout website\/app|đang được liệt kê|độ chính xác đơn cần cải thiện|unknown_or_unverified|modifier option availability|\(\s*(?:nguồn|source)\s*:|(?:chỉ|đang)\s+(?:là\s+)?tư vấn|chưa\s+(?:thêm|thay đổi|cập nhật)[^.!?\n]{0,80}(?:giỏ|món|combo)/i,
    );
  });
});
