/**
 * Vietnamese catalogue.
 *
 * ⚠ THE ONLY FILE IN THE REPOSITORY EXEMPT FROM THE ENGLISH-SOURCE RULE, and the
 * exemption covers the VALUES ONLY — comments here stay English like everywhere
 * else. `scripts/check-language.ts` allows this path by name; nothing else.
 *
 * Every value must be the exact string the product ships today. This file is
 * what keeps all 843 tests green through the migration: the suite runs at the
 * default locale (`vi`), so a `t()` call must return byte-for-byte what the
 * hard-coded literal returned before it. Improving the wording while moving it
 * here would turn a mechanical migration into a behaviour change with no test
 * to catch it.
 *
 * `: Catalog` is the gate — a missing or extra key fails `tsc`, not runtime.
 */

import type { Catalog, PluralCatalog } from './en.js';

export const vi: Catalog = {
  // ─────────────────────────────────────────────────────────────── common
  'common.save': 'Lưu',
  'common.cancel': 'Thôi',
  'common.delete': 'Xoá hẳn',
  'common.close': 'Đóng',
  'common.retry': 'Thử lại',
  'common.loading': 'Đang tải…',
  'common.create': 'Tạo',
  'common.creating': 'Đang tạo…',
  'common.saving': 'Đang lưu…',
  'common.deleting': 'Đang xoá…',
  'common.reading': 'Đang đọc…',
  'common.saveFailed': 'Không lưu được.',
  'common.copyRef': 'Chép tham chiếu {path}',
  'common.copyPath': 'Copy đường dẫn',
  'common.dismissNotice': 'Đóng thông báo',

  // ────────────────────────────────────────────────────────────────── app
  'app.fatalTitle': 'Mất kết nối tới công ty',
  'app.poweredOff': 'Công ty đã tắt. Bạn có thể đóng thẻ này.',
  'app.openingCompany': 'Đang mở công ty…',
  'app.openingOffice': 'Đang mở văn phòng…',
  'app.noOfficesTitle': 'Công ty chưa có văn phòng nào',
  'app.noOfficesHint':
    'Mỗi văn phòng có Trợ lý riêng, nhân viên riêng và kho tri thức riêng. Tạo cái đầu tiên để bắt đầu.',
  'app.newOffice': 'Tạo văn phòng',
  'app.noAgentsTitle': 'Văn phòng này chưa có nhân viên',
  'app.noAgentsHintBefore':
    'Trợ lý không tự làm việc — nó chia việc cho người khác. Thêm người đầu tiên bằng nút',
  'app.noAgentsHintAfter': 'ở góc trên bên trái.',
  'app.canvasHint': 'Kéo node để sắp xếp · kết nối Trợ lý và nhân viên để giao quyền',
  'app.planRunning': 'đang chạy…',

  // ─────────────────────────────────────────────────── the office view (room)
  'office.desk': 'Bàn hồ sơ',
  'office.openResults': 'mở ngăn Kết quả',
  'office.openLibrary': 'mở Tủ tài liệu',
  'office.armNone': 'Chưa có kết nối',
  'office.breakArea': 'Khu giải lao',
  'office.summary': '{working} đang làm, {resting} đang nghỉ',
  'office.viewDiagram': 'Sơ đồ',
  'office.viewRoom': 'Văn phòng',
  'office.viewDiagramTip': 'Sơ đồ: dựng và nối dây cho công ty',
  'office.viewRoomTip': 'Căn phòng: xem đang có chuyện gì xảy ra',
  'office.character': 'Nhân vật',
  'office.characterPick': 'Nhân vật {n}',
  'office.tint': 'Màu trang phục',
  'office.tintCustom': 'Chọn màu bất kỳ',
  'office.hireHint': 'Chưa có ai làm việc ở đây. Chuyển sang sơ đồ để tuyển người đầu tiên.',
  'office.zoomIn': 'Phóng to',
  'office.zoomOut': 'Thu nhỏ',

  // ───────────────────────────────────────────────────────────────── chat
  'chat.you': 'bạn',
  'chat.assistant': 'Trợ lý',
  'chat.emptyTitle': 'Chưa nói gì với Trợ lý',
  'chat.emptyHint':
    'Giao việc, hoặc hỏi han bình thường. Trợ lý tự phân biệt — chào hỏi không tốn token của nhân viên nào.',
  'chat.emptyHintTypeBefore': 'Gõ',
  'chat.emptyHintTypeAfter': 'để xem danh sách lệnh.',
  'chat.placeholder': 'Giao việc, hoặc hỏi Trợ lý…',
  'chat.messageLabel': 'Tin nhắn',
  'chat.send': 'Gửi',
  'chat.openPreview': 'Mở xem trước trong ngăn Kết quả',

  // ─────────────────────────────────────────────────────────────── header
  'header.office': 'Văn phòng',
  'header.archivedSuffix': ' (lưu trữ)',
  'header.rename': 'Đổi tên văn phòng',
  'header.renameTip': 'Đổi tên văn phòng đang mở',
  'header.newOffice': 'Văn phòng',
  'header.newOfficeTip': 'Tạo văn phòng mới',
  'header.stop': 'Dừng',
  'header.stopTip': 'Dừng việc đang chạy. Daemon vẫn sống.',
  'header.shutdown': 'Tắt hẳn',
  'header.shutdownConfirm': 'Tắt hẳn?\n\nCông ty sẽ ngừng lại.',
  // A name, a symbol and two numbers — the same line in both catalogues, and it
  // stays in the catalogue because no user-visible string is written in a component.
  'settings.footer': 'AgentCo © {year} · v{version}',
  'settings.updateTo': 'Cập nhật lên {version}',
  'settings.updateWorking': 'Đang cập nhật — trang này sẽ tự quay lại.',
  'settings.updateFailed': 'Không có gì thay đổi. Bản cũ vẫn đang chạy — xem terminal.',
  'settings.updatePending':
    'Đã cài xong v{version} — nó sẽ chạy ở lần mở agentco kế tiếp. Lúc đó đang có việc chạy nên không có gì bị ngắt.',
  'header.companyRenameTip': 'Tên công ty — nháy đúp để sửa',
  'header.state.idle': 'rảnh',
  'header.state.working': 'đang làm',
  'header.state.paused': 'tạm nghỉ',
  'header.state.stopped': 'đã tắt',
  'header.window.session': 'Phiên',
  'header.window.weekly': 'Tuần',
  'header.energy.allowed': 'còn thoải mái',
  'header.energy.allowed_warning': 'sắp chạm hạn mức',
  'header.energy.rejected': 'đã chạm hạn mức',
  'header.energyTip':
    'Hạn mức tài khoản Claude của bạn — dùng chung với Claude Code và claude.ai, KHÔNG phải chi phí của văn phòng này. ',
  'header.energyTipPlan':
    'Hạn mức tài khoản Claude ({plan}) của bạn — dùng chung với Claude Code và claude.ai, KHÔNG phải chi phí của văn phòng này. ',
  'header.energyUsed': 'đã dùng {pct}%',
  'header.energyResets': ', làm mới {when}',

  // ────────────────────────────────────────────────────────────── toolbar
  'toolbar.agent': 'Nhân viên',
  'toolbar.agentTip': 'Thêm nhân viên vào văn phòng này',
  'toolbar.arm': 'Kết nối',
  'toolbar.armTip': 'Cắm một kết nối cho nhân viên dùng',
  'toolbar.arrange': 'Sắp xếp lại',
  'toolbar.arrangeTip': 'Sắp xếp lại sơ đồ',
  'toolbar.fit': 'Vừa khung',
  'toolbar.zoomOut': 'Thu nhỏ',
  'toolbar.zoomIn': 'Phóng to',

  // ────────────────────────────────────────────────────────────── confirm
  'confirm.toDelete': 'để xoá',
  'confirm.toCancel': 'để thôi',

  // ─────────────────────────────────────────────────────────────── errors
  'error.httpStatus': 'Máy chủ trả về lỗi {status}.',
  'error.lostDaemon': 'Mất kết nối tới công ty. Kiểm tra terminal — daemon còn chạy không?',
  'error.pathOutside': 'Đường dẫn ra ngoài thư mục: {path}',

  // ────────────────────────────────────────── loading company.yaml / office.yaml
  'cfg.notYaml': '{file} không phải YAML hợp lệ: {reason}',
  'cfg.noCompanyYaml': 'Không tìm thấy company.yaml trong {dir}.\nChạy `agentco init` để tạo công ty mới.',
  'cfg.badCompanyYaml': 'company.yaml sai định dạng:\n{detail}',
  'cfg.badOfficeYaml': 'offices/{office}/office.yaml sai định dạng:\n{detail}',

  // ─────────────────────────────────────────────────────── the cost report
  'cost.shift': 'Ca làm việc',
  'cost.nothingYet': 'Chưa có việc nào được ghi nhận.',
  'cost.tasks': '{n} việc',
  'cost.totalTokens': 'Tổng token',
  'cost.tokenBreakdown': 'vào {input} · đọc-cache {cacheRead} · ghi-cache {cacheWrite} · ra {output}',
  'cost.spend': 'Chi phí',
  'cost.cacheReuse': 'Tỉ lệ dùng lại cache',
  'cost.cacheBelow': 'dưới ngưỡng 70% — prefix đang bị phá',
  'cost.tokensPerTask': 'Token/việc (p50 / p95)',
  'cost.colRole': 'vai trò',
  'cost.colModel': 'model',
  'cost.colTasks': 'việc',
  'cost.colTurns': 'lượt/việc',
  'cost.colTokens': 'token/việc',
  'cost.colSeconds': 'giây/việc',
  'cost.colCost': '$/việc',
  'cost.priciest': 'Tốn nhất',
  'cost.reask': 'Phải hỏi lại định dạng',
  'cost.reaskDetail': '{n} lần  ⚠ tốn thêm — xem lại prompt của vai trò đó',
  'cost.oddCacheWrites': '⚠ Ghi cache bất thường',
  'cost.oddCacheDetail':
    'vai trò "{role}": {writes} lần ghi cho {keys} khoá — có ai đang sửa role/tri thức giữa ca?',
  'cost.runLine': 'Ca này: {tasks} việc · {cost} · {breakdown} · dùng lại cache {reuse}',

  // ──────────────────────────────────────────── slash commands in the chat box
  'cmd.stop': 'Ngắt việc đang chạy',
  'cmd.approve': 'Duyệt thứ đang chờ bạn',
  'cmd.reject': 'Từ chối thứ đang chờ bạn',
  'cmd.status': 'Đang chạy gì, đã tốn bao nhiêu',
  'cmd.resume': 'Chạy tiếp việc còn dở của ca vừa bị ngắt',
  'cmd.clear': 'Dọn cuộc trò chuyện, cất những gì đã chốt vào sổ tay',
  'cmd.help': 'Xem danh sách lệnh này',
  'cmd.orAlias': '(hoặc {list})',
  'cmd.noSuch': 'Không có lệnh "/{typed}". Các lệnh dùng được:',
  'cmd.available': 'Các lệnh dùng được:',
  'cmd.escapeHint': 'Muốn nhắn một câu bắt đầu bằng dấu "/" thì gõ hai dấu: //',
  'cmd.refClash':
    'Có {n} file tên "{name}", mình không đoán bạn muốn cái nào:\n{list}\nDán lại đường dẫn đầy đủ nhé — nút Chép ở ngăn Tủ tài liệu và Kết quả cho đúng chuỗi đó.',
  'cmd.refMissing':
    'Mình không tìm thấy "{name}" trong tủ tài liệu hay ngăn Kết quả. Kiểm lại tên giúp mình, hoặc dùng nút Chép ở hai ngăn đó để lấy đúng đường dẫn.',
  'cmd.lookingUpWeb': 'Đang tra trên web…',
  'cmd.reading': 'Đang đọc {names}…',

  // ───────────────────────────────────── document cabinet: names and sniffing
  'lib.refuseImageText':
    'Ảnh thì nhân viên không tìm bằng từ khoá được. Nếu ảnh có chữ, hãy xuất ra PDF rồi thả lại.',
  'lib.refuseImage': 'Ảnh thì nhân viên không tìm bằng từ khoá được.',
  'lib.refuseVideo': 'Video chưa nằm trong phạm vi tủ tài liệu.',
  'lib.refuseAudio': 'Âm thanh chưa nằm trong phạm vi tủ tài liệu.',
  'lib.refuseArchive': 'File nén chưa nhận. Giải nén ra rồi thả từng file vào.',
  'lib.refuseExecutable': 'Không nhận file chạy được.',
  'lib.refuseDoc': 'Định dạng Word cũ (.doc) khác hẳn .docx bên trong. Mở bằng Word rồi "Lưu thành" .docx.',
  'lib.refuseXls': 'Định dạng Excel cũ (.xls) khác hẳn .xlsx bên trong. Mở bằng Excel rồi "Lưu thành" .xlsx.',
  'lib.refusePpt': 'Định dạng PowerPoint cũ (.ppt). Mở rồi "Lưu thành" .pptx.',
  'lib.nameEmpty': 'Tên file rỗng.',
  'lib.nameTooLong': 'Tên file quá dài. Đổi tên ngắn lại rồi thả lại.',
  'lib.nameHasSlash': 'Tên file không được chứa dấu / hoặc \\.',
  'lib.nameInvalid': 'Tên file không hợp lệ.',
  'lib.namePipe': 'Tên file không được chứa dấu |. Đổi tên rồi thả lại.',
  'lib.nameControlChar': 'Tên file chứa ký tự không hợp lệ.',
  'lib.nameLeadingDot': 'Tên file không được bắt đầu bằng dấu chấm — nhân viên sẽ không tìm thấy nó.',
  'lib.nameTrailingDot': 'Tên file không được kết thúc bằng dấu chấm hoặc khoảng trắng.',
  'lib.nameNoExtension': 'File phải có phần đuôi (ví dụ .pdf, .docx).',
  'lib.nameWindowsDevice': '"{stem}" là tên thiết bị Windows chiếm dụng. Đổi tên khác.',
  'lib.extNotAccepted': 'Chưa nhận đuôi .{ext}. Nhận: {list}.',
  'lib.extUnknown': 'Chưa nhận đuôi .{ext}.',
  'lib.notRealPdf': 'File này không phải PDF thật, dù có đuôi .pdf.',
  'lib.notRealZip': 'File này không phải .{ext} thật (bên trong phải là gói ZIP).',
  'lib.notText': 'File này là dữ liệu nhị phân, không phải văn bản .{ext}.',
  'lib.fileEmpty': 'File rỗng.',
  'lib.fileTooBig':
    'File nặng {size}, vượt trần {ceiling}. Nếu là bản chụp/scan thì nén lại hoặc tách nhỏ trước khi thả vào.',
  'lib.duplicate': 'Đã có tài liệu tên "{name}" trong tủ.',
  'lib.notePdfReaderMissing':
    'Bộ đọc PDF chưa nạp được nên chưa tìm được bằng từ khoá — nhiều khả năng bản cài thiếu file. Nhân viên vẫn đọc được nếu bạn nói rõ trang. Chạy lại `npm install` trong thư mục agentco rồi thả lại file.',
  'lib.noteImageOnly':
    'Bản chụp, không có lớp chữ — tìm bằng từ khoá sẽ không ra. Nhân viên phải đọc từng trang nên tốn hơn bình thường.',
  'lib.notePassword': 'File có mật khẩu — bỏ mật khẩu rồi thả lại.',
  'lib.noteTooLarge': 'File quá lớn để đọc. Tách nhỏ rồi thả lại.',
  'lib.noteCorruptZip':
    'File .{ext} hỏng hoặc không đúng định dạng. Mở bằng ứng dụng gốc rồi "Lưu thành" một bản mới.',
  'lib.noteUnreadable': 'Không đọc được nội dung: {detail}',
  'lib.shapeFirstRow': 'hàng đầu: {cells}',
  'lib.statePending': 'đang chờ',
  'lib.stateExtracting': 'đang đọc',
  'lib.stateReady': 'sẵn sàng',
  'lib.stateImageOnly': 'bản chụp',
  'lib.stateUnindexed': 'chưa lập chỉ mục',
  'lib.stateFailed': 'lỗi',

  // ─────────────────────────────────────────────── OAuth handshake failures
  'oauth.stepExchange': 'đổi mã',
  'oauth.stepRefresh': 'làm mới',
  'oauth.stepPoll': 'hỏi thăm',
  'oauth.stepDeviceStart': 'xin mã',
  'oauth.stepNoReach': '[{step}] không gọi ra được {url}: {reason}',
  'oauth.stepServiceDown': '[{step}] dịch vụ đang lỗi ({code}).',
  'oauth.stepFailed': '[{step}] hỏng: {code}{desc}',
  'oauth.stepHttp5xx': '[{step}] dịch vụ trả HTTP {status}.',
  'oauth.stepUnreadable': '[{step}] phản hồi không đọc được (HTTP {status}): {body}',
  'oauth.stepNoAccessToken': '[{step}] phản hồi không có access_token (HTTP {status}).',
  'oauth.grantDead': 'Chìa không còn hiệu lực — cần đăng nhập lại. ({code})',
  'oauth.noEgress':
    'Không gọi ra được tới {url}.\nĐây là kết nối ĐI RA từ máy chạy agentco, không phải kết nối vào — nên tường lửa vào, nginx hay VPN đều không phải chỗ cần sửa.\nKiểm: máy này có ra internet không · công ty có bắt đi qua proxy không (Node không tự đọc HTTPS_PROXY, phải bật NODE_USE_ENV_PROXY=1).',
  'oauth.notMcpDoor':
    '{url} trả HTTP {status} — không phải cửa MCP, cũng không phải đòi chìa. Nhiều khả năng sai URL.',
  'oauth.noMetadata': 'Không đọc được metadata uỷ quyền của {issuer} (đã thử {tried} đường).',
  'oauth.noDcr':
    '{issuer} không mở đăng ký động — dịch vụ này bắt phải tự tạo app và dán client_id vào.',
  'oauth.registerFailed': 'Đăng ký hỏng: HTTP {status} — {body}',
  'oauth.noRefreshToken': 'Tài khoản này không có chìa làm mới — phải đăng nhập lại.',
  'oauth.noDeviceFlow': '{issuer} không hỗ trợ đăng nhập bằng mã thiết bị.',
  'oauth.deviceStartFailed':
    '[xin mã] hỏng (HTTP {status}): {detail}\nKiểm trước tiên: ứng dụng đã bật "đăng nhập bằng mã thiết bị" ở phía dịch vụ chưa.',
  'oauth.deviceCodeExpired': 'Mã đăng nhập đã hết hạn — bấm Đăng nhập lại để lấy mã mới.',
  'oauth.accessDenied': 'Bạn đã từ chối cấp quyền ở trang của dịch vụ.',

  // ───────────────────────────────────── plan checking and scheduler receipts
  'plan.noSuchRole': 'Task {task}: không có vai trò "{role}"',
  'plan.noSuchDep': 'Task {task}: phụ thuộc "{dep}" không tồn tại',
  'plan.twoWriters': 'Task {task} và {other} cùng ghi "{path}"',
  'plan.inputMissingOnDisk':
    'Task {task} cần đọc "{path}" nhưng không tìm thấy trên máy — kiểm lại đường dẫn',
  'plan.inputMissingUnwritten':
    'Task {task} cần đọc "{path}" nhưng không có file đó, và không việc nào tạo ra nó',
  'plan.connectionNoArm':
    'Task {task} muốn lấy "{path}" qua một kết nối, nhưng "{role}" chưa được nối với kết nối nào',
  'plan.cycle': 'Phụ thuộc vòng tròn: {trail}',
  'plan.blockedPrevUnfinished': 'Không làm được vì bước trước chưa xong.',
  'plan.blockedPrevCut': 'Không làm được vì bước trước bị cắt giữa chừng, kết quả của nó còn thiếu.',
  'plan.whyHalfWritten': 'ghi dở, chưa đủ để dùng',
  'plan.blockedMissingInput': 'Không làm được vì thiếu file cần đọc.',
  'plan.whyNotOnDisk': 'không có trên đĩa',
  'plan.continuing': 'Việc dài hơn một lượt — đang chạy tiếp ({n}/{max}).',
  'plan.roleGone': 'Không có vai trò "{role}"',
  'plan.stalePrevUnfinished': 'bước trước chưa chạy xong: {list}',
  'plan.stalePrevEmpty': 'bước trước không tạo ra file nào: {list}',
  'plan.causeMaxTurns':
    'Việc này cần nhiều bước hơn mức cho phép của {role}. Nới số bước tối đa trong trang nhân viên, hoặc chia nhỏ yêu cầu.',
  'plan.causeBudget':
    'Việc này chạm trần chi phí đã đặt cho {role}. Nới trần chi phí trong trang nhân viên nếu thấy đáng.',
  'plan.causeError': 'Việc này gặp lỗi và không hoàn thành được. Xem nhật ký chi tiết.',
  'plan.doneWrote': 'Đã làm xong và ghi ra {what}.',
  'plan.asideOverBudget':
    'Chỉ lưu ý nhỏ: việc này tốn hơn mức chi phí bạn đặt cho {role}, nên nếu còn giao việc tương tự thì cân nhắc nới trần lên một chút.',
  'plan.asideMaxTurns':
    'Chỉ lưu ý nhỏ: việc này dùng hết số bước tối đa của {role} — nếu còn giao việc tương tự thì cân nhắc nới lên một chút.',
  'plan.partialWrote':
    'Nhân viên đã ghi được {n} file trước khi dừng: {list}. Xem thử trước khi quyết chạy lại — có thể đã đủ dùng.',
  'plan.wroteOutsideOffice': 'ghi ra ngoài văn phòng: {list}',

  // ──────────────────────────────── company: offices, models and connections
  'co.officeBroken': 'Văn phòng "{office}" đang lỗi: {why}',
  'co.noOffice': 'Không có văn phòng "{office}".',
  'co.officeNameNeedsAlnum': 'Tên văn phòng cần có ít nhất một chữ cái hoặc số.',
  'co.officeNameTooLong': 'Tên văn phòng dài quá 60 ký tự.',
  'co.officeExists': 'Đã có văn phòng "{id}".',
  'co.officeCreated': 'Đã tạo văn phòng "{name}".',
  'co.officeBusyRename':
    'Văn phòng đang chạy việc, chưa đổi tên thư mục được. Bấm Dừng rồi thử lại — hoặc đổi tên sau khi việc xong.',
  'co.officeRenamedWithFolder': 'Đã đổi tên văn phòng thành "{name}", và thư mục trên đĩa cũng đổi theo.',
  'co.officeRenamed': 'Đã đổi tên văn phòng thành "{name}".',
  'co.folderExists': 'Thư mục "{id}" đã tồn tại.',
  'co.officeNameTaken':
    'Đã có văn phòng tên "{name}". Hai văn phòng trùng tên thì ô chọn ở đầu màn hình hiện hai dòng y hệt nhau — đặt tên khác đi.',
  'co.noValidModelField': 'Không có trường model nào hợp lệ.',
  'co.valueEmpty': 'Giá trị cho "{key}" không được để trống.',
  'co.mustBeTier': '"{key}" phải là một MỨC: {tiers}.',
  'co.modelsChanged': 'Đã đổi model. Việc đang chạy giữ nguyên model cũ cho tới khi xong.',
  'co.unsupportedLanguage': 'Ngôn ngữ "{language}" không có trong danh sách hỗ trợ.',
  'cli.checkClaude': 'Claude Code',
  'cli.checkClaudeNo':
    'không tìm thấy — hãy cài Claude Code, hoặc khai `claude_path:` trong company.yaml (các đường đã thử ở dưới)',
  'co.nameTooLong': 'Tên công ty tối đa {max} ký tự.',
  'co.nameChanged': 'Đã đổi tên công ty.',
  'co.armConfigMissing': 'Thiếu cấu hình cho cánh tay này.',
  'co.armAlreadyHere':
    'Văn phòng này đã có kết nối "{label}". Kéo dây từ nó sang nhân viên cần dùng — một kết nối dùng chung được cho nhiều người.',
  'co.folderAlreadyCovered':
    'Thư mục này đã nằm trong kết nối "{id}" của văn phòng. Nối thẳng "{id}" vào nhân viên cần nó — một kết nối dùng chung được cho nhiều người, và cắm thêm cái thứ hai là trả token hai lần cho cùng một thứ.',
  'co.armPlugged': 'Đã cắm "{label}". Nhân viên được nối dây sẽ dùng được ngay ở việc kế tiếp.',
  'co.armNameEmpty': 'Tên kết nối không được để trống.',
  'co.noArm': 'Không có kết nối "{id}".',
  'co.armRenamed': 'Kết nối giờ tên là "{name}".',
  'co.armUnplugged': 'Đã rút "{label}". Cắm lại lúc nào cũng được — cấu hình và chìa vẫn giữ.',
  'co.armDeleted': 'Đã xoá hẳn "{label}" khỏi sổ chung. Chìa vẫn được giữ.',
  'co.armStillInUse':
    '"{label}" vẫn đang ở {n} văn phòng ({offices}). Rút khỏi từng chỗ trước đã — xoá hẳn một thứ đang được dùng là làm hỏng sơ đồ của người khác.',
  'co.armGoneFromList':
    'Không còn kết nối "{id}" trong sổ chung — có lẽ nó vừa bị gỡ. Đóng hộp thoại rồi mở lại.',
  'co.officeBusyStopFirst': 'Văn phòng đang chạy việc. Bấm Dừng trước đã.',
  'co.officeArchived': 'Đã cất văn phòng "{name}" vào lưu trữ. Khôi phục được bất cứ lúc nào.',
  'co.officeRestored': 'Đã khôi phục văn phòng "{name}".',
  'co.officeIdInvalid': 'Mã văn phòng không hợp lệ.',
  'co.officeDeleted': 'Đã xoá hẳn văn phòng "{id}" và các dòng chi phí của nó.',
  'co.ledgerPurged': 'Đã dọn {n} mục không còn khỏi sổ chi phí.',
  'co.beforeOfficesSplit': '(trước khi tách văn phòng)',

  // ────────────────────────────────── the office: what the assistant says back
  'off.planFailedHead': 'Mình chia việc bị lỗi nên chưa chạy được. Chưa nhân viên nào bắt tay vào làm',
  'off.planFailedRetry':
    'Bạn nhắn lại yêu cầu rõ hơn một chút, hoặc nói cụ thể tên tài liệu cần dùng nhé.',
  'off.planFailedStuck':
    'Đây là lần thứ {n} mình kẹt y hệt, nên gõ lại lần nữa nhiều khả năng cũng vậy — vướng nằm ở chỗ mình chia việc, không nằm ở cách bạn diễn đạt. Thử bỏ bớt một yêu cầu trong câu (nhất là chỗ chỉ định nơi lưu file), hoặc tách ra hai lần nhắn.',
  'off.cutByShutdown':
    'Việc này bị ngắt giữa chừng vì công ty tắt (cập nhật, khởi động lại, hoặc mất điện). Những phần đã xong vẫn còn trong ngăn Kết quả — nhắn lại để mình làm nốt phần còn lại.',
  'off.officeArchivedReadOnly':
    'Văn phòng "{name}" đang trong lưu trữ nên chỉ xem được. Khôi phục nó ở bảng Tổng quan công ty rồi làm tiếp.',
  'off.stopping': 'Đang dừng…',
  'off.mailboxFlooded': 'Bạn nhắn nhanh quá — mình còn {n} tin chưa đọc. Chờ mình xử lý xong đã nhé.',
  'off.messageFailed': 'Có lỗi khi xử lý tin nhắn của bạn.',
  'off.refsMissing':
    'Mình không tìm thấy {list} trong tủ tài liệu hay ngăn Kết quả. Bạn kiểm lại tên giúp mình, hoặc dùng nút Chép ở hai ngăn đó để lấy đúng đường dẫn nhé.',
  'off.lookupNoAnswerFiles':
    'Mình đọc rồi nhưng chưa rút ra được câu trả lời. Bạn hỏi cụ thể hơn một chút, hoặc giao hẳn cho một nhân viên đọc kỹ nhé.',
  'off.lookupNoAnswerWeb': 'Mình tra rồi nhưng chưa ra câu trả lời chắc chắn. Bạn hỏi cụ thể hơn một chút nhé.',
  'off.lookupPartial': '(Mình không tìm thấy {list} nên câu trên chỉ dựa trên {n} tài liệu còn lại.)',
  'off.busyWillFollow': 'Mình đang bận một việc rồi. Xong việc này mình làm tiếp việc bạn vừa giao nhé.',
  'off.addendumNoted': 'Đã ghi nhận bổ sung. Mình áp dụng ngay khi việc đang chạy xong.',
  'off.clearing': 'Đang dọn cuộc trò chuyện, cất lại những gì bạn đã chốt… (mất vài giây)',
  'off.nothingRunning': 'Hiện không có việc nào đang chạy.',
  'off.stoppingAll': 'Đang dừng tất cả.',
  'off.stoppedAssistantTurn': 'Đã cắt lượt Trợ lý đang chạy.',
  'off.droppedQueued': 'Đã bỏ {n} việc còn trong hàng đợi.',
  'off.finishedWorkKept': 'Việc đã xong vẫn giữ nguyên — gõ /resume để mình làm nốt.',
  'off.nothingHalfDone': 'Không có việc nào đang dở cả. Nhắn cho mình việc mới nhé.',
  'off.busyResumeLater': 'Văn phòng đang bận. Đợi xong ca này rồi gõ /resume nhé.',
  'off.resuming': 'Chạy tiếp {n} việc còn dở{of}. Mình không chia lại việc — kế hoạch cũ vẫn còn.',
  'off.resumingOf': ' của "{request}"',
  'off.resumeFailed': 'Chưa chạy tiếp được.',
  'off.idleWithLeftovers':
    'Đang rảnh, nhưng còn {n} việc dở của "{request}". Gõ /resume để làm nốt — mình không chia lại việc nên không tốn thêm lượt nào.',
  'off.idle': 'Đang rảnh. Văn phòng có {total} nhân viên, {onDuty} người đang trực.',
  'off.statusRunning':
    'Đang làm: {request}\nBước {step}/{steps} · {done}/{total} việc · {turns} lượt · {cost}',
  'off.clearBusy': 'Đang có việc chạy dở. Bấm Dừng hoặc chờ xong rồi mình dọn nhé.',
  'off.clearFailedKept': 'Chưa dọn được cuộc trò chuyện. Mình giữ nguyên mọi thứ, thử lại sau nhé.',
  'off.nothingToApprove': 'Hiện không có gì đang chờ bạn duyệt.',
  'off.stateResuming': 'Đang chạy tiếp việc còn dở...',
  'off.statePlanning': 'Trợ lý đang lập kế hoạch...',
  'off.stateReadingDocs': 'Đang đọc tài liệu {names}…',
  'off.statePaused': 'Tạm nghỉ.',
  'off.stateStopped': 'Đã dừng.',
  'off.stateWaitingOnYou': 'Đang chờ bạn trả lời.',
  'off.stateDone': 'Xong việc.',
  'off.noRolesAtAll':
    'Văn phòng này chưa có nhân viên nào. Bấm "+ Nhân viên" trên sơ đồ để thêm người đầu tiên.',
  'off.noRolesWired':
    'Chưa có nhân viên nào được giao việc. Trên sơ đồ, kéo một sợi dây từ Trợ lý xuống một nhân viên.',
  'off.linkedTasks': 'Đã nối {n} việc phải chạy nối tiếp ({list}) — chúng dùng chung file.',
  'off.browserLoginOpen':
    'Cửa sổ đăng nhập của văn phòng này đang mở, nên nhân viên chưa dùng được trình duyệt. Đóng cửa sổ đó rồi giao việc lại.',
  'off.rateLimited':
    'Hết lượt dùng Claude. Văn phòng tạm nghỉ, còn {n} việc chưa làm. Gõ /resume khi có lượt lại.',
  'off.notSignedIn': 'Chưa đăng nhập Claude Code. Chạy `claude` một lần để đăng nhập rồi thử lại.',
  'off.stopped': 'Đã dừng. Xong {done}/{total} việc, còn {left} việc chưa làm.',
  'off.stoppedHave': 'Đã có: {list}.',
  'off.resultsSaved': 'kết quả đã lưu',
  'off.stoppedResumeHint':
    'Gõ /resume để mình làm nốt — việc nào đã xong trọn thì giữ nguyên, việc bị cắt giữa chừng sẽ làm lại cho đủ.',
  'off.sharedKnowledge': 'Kho tri thức chung',
  'off.documentCabinet': 'Tủ tài liệu',
  'off.docDeletedWithNotes': 'Đã xoá "{name}" và {n} ghi chú chỉ có nghĩa nhờ tài liệu đó.',
  'off.layoutUpdated': 'Sơ đồ văn phòng đã cập nhật.',
  'off.roleIdShape': 'Mã nhân viên chỉ dùng chữ thường, số, gạch ngang.',
  'off.roleIdReserved': '"assistant" là tên dành riêng cho Trợ lý.',
  'off.roleExists': 'Văn phòng này đã có nhân viên "{id}".',
  'off.roleAdded': 'Đã thêm "{name}".',
  'off.roleIdInvalid': 'Mã nhân viên không hợp lệ.',
  'off.noRole': 'Không có nhân viên "{id}".',
  'off.roleFileMissing': 'Không tìm thấy file roles/{id}.yaml.',
  'off.roleArchived': 'Đã cất "{name}" vào lưu trữ.',
  'off.roleRestored':
    'Đã đưa "{name}" trở lại sơ đồ. Kéo một sợi dây từ Trợ lý xuống nếu muốn giao việc cho họ.',
  'off.roleDeleted': 'Đã xoá hẳn "{id}".',
  'off.roleUpdated': 'Đã cập nhật hồ sơ "{id}".',
  'off.pitchEmpty': 'Giới thiệu không được để trống — đây là thứ duy nhất Trợ lý thấy.',
  'off.tierMustBe': 'Mức model phải là một trong: {tiers}.',
  'off.budgetShape': 'Trần chi phí phải là số không âm. Đặt 0 nghĩa là không giới hạn.',
  'off.maxTurnsShape': 'Số bước tối đa phải là số nguyên từ 1 trở lên.',
  'off.officeNameEmpty': 'Tên văn phòng không được để trống.',
  'off.officeRenamed': 'Văn phòng đã đổi tên thành "{name}".',
  'off.assistantTierChanged': 'Trợ lý chuyển sang mức "{tier}". Áp dụng từ lượt trò chuyện tiếp theo.',
  'off.assistantNameEmpty': 'Tên Trợ lý không được để trống.',
  'off.assistantNameTooLong': 'Tên Trợ lý dài quá 40 ký tự.',
  'off.assistantRenamed': 'Trợ lý giờ tên là "{name}".',
  'off.noLayer': 'Không có lớp "{id}".',
  'off.layerReadOnly':
    'Lớp này chỉ đọc. Lớp lõi thuộc về mã nguồn — mở khoá bằng `allow_core_prompt_edit: true` trong company.yaml nếu bạn thật sự cần.',
  'off.layerTooLong':
    'Dài quá: {tokens} token, trần là {limit}. Khối này nằm trong prefix cache nên mỗi dòng thừa là chi phí thu suốt ca làm việc.',
  'off.layerSaved':
    'Đã lưu và áp dụng ngay — không cần khởi động lại. Nhân viên nhận việc từ giờ dùng bản mới; việc đang chạy vẫn theo bản cũ cho tới khi xong. Lượt đầu của mỗi nhân viên sẽ tốn thêm một chút vì phải ghi lại bộ nhớ đệm.',
  'off.noNote': 'Không có ghi chú "{id}".',
  'off.officeBusyWait': 'Văn phòng đang bận. Đợi xong ca này đã.',
  'off.nothingToResume': 'Không có việc nào đang dở để chạy tiếp.',
  'off.nothingNewToRemember': 'Chưa có gì mới để nhớ.',
  'off.nothingToRemember': 'Chưa có gì để nhớ — bắt đầu mới luôn.',
  'off.memoryUpTo': 'Ghi nhớ tới {date}',
  'off.anError': 'lỗi',
  'off.compactFailed':
    'Chưa nén được trí nhớ ({reason}), nên mình giữ nguyên cuộc trò chuyện. Bạn thử lại /clear sau nhé.',
  'off.transcriptGone':
    'Mình không đọc lại được cuộc trò chuyện cũ (bản ghi của Claude Code đã bị dọn), nên không cất lại được gì. Đã dọn ô chat, bắt đầu mới.',
  'off.clearedWithNotebook':
    'Đã dọn cuộc trò chuyện. Những gì bạn đã chốt mình cất vào sổ tay riêng, mở ở ngăn Tri thức xem được.',
  'off.cleared': 'Đã dọn cuộc trò chuyện.',
  'off.autoCompacted': 'Cuộc trò chuyện đã dài, mình dọn bớt cho nhẹ. {note}',
  'off.sweptAlso': 'Dọn luôn {what}.',
  'off.sweptAnd': ' và ',
  // ──────────────────────────── the assistant: sentences CODE writes, not the model
  'as.emptyReply':
    'Mình gọi được model nhưng nó không trả về gì cả — lỗi đường truyền, không phải cách bạn nói. Nhắn lại giúp mình nhé.',
  'as.emptyReplyPlanning':
    'Mình gọi được model nhưng nó không trả về gì cả — lỗi này nằm ở đường truyền, không phải ở cách bạn nói. Thử lại sau một chút nhé.',
  'as.noUsableAnswer':
    'Lượt vừa rồi chưa ra được câu trả lời dùng được. Bạn thử nói lại theo cách khác, hoặc chia nhỏ yêu cầu ra giúp mình.',
  'as.planTextNotJson':
    'Mình chưa chia được việc này. Thay vì một kế hoạch, Trợ lý nói:\n  "{text}"\nCâu đó lẽ ra phải đi qua đường hỏi lại chứ không phải viết thẳng ra như vậy — nên đây là lỗi của mình, không phải của cách bạn nói. Cứ giao lại y nguyên: phần lớn ca như thế chạy được ở lần thứ hai. Nếu nó hỏi một điều gì cụ thể thì trả lời luôn trong câu giao việc.',
  'as.done': 'Đã xong.',
  'as.stoppedByUser': 'Đã dừng theo yêu cầu của bạn.',

  // ─────────────────────────────────── the employee: status line and stop reasons
  'wk.doingRead': 'đang đọc tài liệu',
  'wk.doingReadFile': 'đang đọc {file}',
  'wk.doingWrite': 'đang viết kết quả',
  'wk.doingWriteFile': 'đang viết {file}',
  'wk.doingSearchIn': 'đang tìm{term} trong {room}',
  'wk.doingSearchOutside': 'đang tìm{term} ngoài văn phòng',
  'wk.doingWebSearch': 'đang tìm trên web',
  'wk.doingWebFetch': 'đang đọc một trang web',
  'wk.doingRunCommand': 'đang chạy lệnh',
  'wk.doingRunning': 'đang chạy: {cmd}',
  'wk.doingUsingTool': 'đang dùng {tool}',
  'wk.doingWorking': 'đang làm việc',
  'wk.roomLibrary': 'tủ tài liệu',
  'wk.roomArtifacts': 'kết quả đã có',
  'wk.roomKnowledge': 'kho tri thức',
  'wk.roomOffice': 'văn phòng',
  'wk.hitBudget': 'Task {task} chạm trần ngân sách {ceiling}',
  'wk.hitMaxTurns': 'Việc này cần nhiều bước hơn mức cho phép ({turns} bước) nên đã dừng giữa chừng.\n',
  'wk.hitMaxTurnsWithArm':
    '⚠ Nhân viên ĐÃ gọi ra kết nối bên ngoài trước khi dừng — có thể đã thay đổi thứ gì đó ở ngoài, và không rõ tới đâu. Xem nhật ký của kết nối để biết chính xác nó đã làm gì.\n',
  'wk.hitMaxTurnsNext':
    'Cách đi tiếp: chia việc thành các bước nhỏ hơn, hoặc nâng số bước tối đa của nhân viên này.',
  'wk.receiptUnreadable': 'Nhân viên trả về kết quả không đọc được. Xem nhật ký chi tiết.',
  'wk.receiptInvalid': 'receipt không hợp lệ: {problem}',
  'wk.stoppedClean': 'Đã dừng theo yêu cầu của bạn, chưa ghi gì.',
  'wk.stoppedByUser': 'người dùng dừng giữa chừng',
  'wk.stopMaxTurns':
    'Việc này cần nhiều bước hơn mức cho phép trong một lượt nên đã dừng giữa chừng. Thử chia nhỏ yêu cầu, hoặc nói rõ hơn cần làm gì trước làm gì sau.',
  'wk.stopBudget': 'Lượt này chạm trần chi phí đã đặt cho công việc.',
  'wk.stopUsageLimit': 'Tài khoản Claude đã hết hạn mức dùng.',
  'wk.stopRateLimit': 'Claude đang quá tải, thử lại sau ít phút.',
  'wk.stopAuth': 'Chưa đăng nhập được vào Claude trên máy này.',
  'wk.stopOther': 'Claude Code dừng giữa chừng ({raw}).',

  'off.leftoversOnBoot':
    'Ca trước còn {n} việc chưa chạy{of}. Gõ /resume là mình làm nốt, dùng lại kế hoạch cũ nên không tốn thêm lượt chia việc nào. Hoặc cứ nhắn việc mới, phần đã xong vẫn nằm trong ngăn Kết quả.',
  'off.wroteOutside':
    'Kết quả đã được ghi nhưng nằm ngoài văn phòng nên panel Kết quả không thấy: {list}. File có thật và dùng được — bạn xem thử rồi bảo mình chép về đúng chỗ, không cần chạy lại từ đầu.',
  'off.filesMissing':
    'Có {n} file lẽ ra phải được ghi mà không thấy trên đĩa: {list}. Nhân viên báo xong nhưng kết quả chưa có — nhắn mình làm lại việc này nhé.',
  'off.startingNow': 'Bắt đầu nhé.',
  'off.resultsSavedAt': 'Kết quả đã lưu tại:',
  'off.perShiftFolder': '(mỗi ca có thư mục riêng để lần chạy sau không đè lên lần này)',
  'off.usedArms': 'Có dùng kết nối: {list}',
  'off.armResultsMayBeOutside': '(kết quả của kết nối có thể nằm ngoài thư mục văn phòng)',
  'off.ranShellCommands': 'Có chạy lệnh trên máy — kết quả có thể nằm ngoài thư mục văn phòng.',
  'off.stepsUnfinishedHead': 'Còn {n}/{total} bước chưa xong',
  'off.stepsUnfinishedTail': 'Kết quả ở trên chỉ tính phần đã làm.',
  'off.pathsMentioned':
    'Bạn có nhắc tới {list}. Kế hoạch luôn đặt kết quả trong thư mục văn phòng, nên file nằm ở đường dẫn ghi bên dưới. Muốn nó nằm thẳng ngoài đó, cắm một kết nối "File trên máy" trỏ vào thư mục ấy rồi giao cho nhân viên — đó là đường duy nhất ghi ra ngoài mà vẫn vào được nhật ký.',

  // ──────────────────────────────────────────────────────────── CLI output
  'cli.noCommand': 'Không có lệnh "{command}".\nChạy `agentco help` để xem danh sách.',
  'cli.alreadyInit': 'Đã có công ty ở {dir}. Không ghi đè.',
  'cli.created': 'Đã tạo công ty ở {dir}\n',
  'cli.createdCompanyYaml': '  company.yaml   cấu hình chung — trần chi phí và model nằm ở đây',
  'cli.createdOffices': '  offices/       mỗi văn phòng một thư mục, tự chứa đầy đủ\n',
  'cli.createdEmpty': 'Công ty đang RỖNG — chưa có văn phòng nào. Đó là bình thường.',
  'cli.createdNext': 'Bước tiếp theo:  agentco start   rồi bấm "Tạo văn phòng"',
  'cli.alreadyRunning': 'Công ty đang chạy sẵn ở {url} (pid {pid})',
  'cli.shutFromUi': '\nĐã tắt theo yêu cầu từ giao diện.',
  'cli.running': '{name} đang chạy',
  'cli.noOfficesHint': '  chưa có văn phòng nào — mở giao diện rồi bấm "Tạo văn phòng"',
  'cli.officeLine': '  {name} {agents} nhân viên · {notes} ghi chú{error}',
  'cli.staleBuild': '\n⚠ Giao diện đang phục vụ bản build CŨ — web/src có thay đổi chưa build.',
  'cli.staleBuildFix': '  npm run build:web    build lại một lần',
  'cli.staleBuildDev': '  npm run dev:web      sửa giao diện có hot-reload',
  'cli.ctrlC': '\nCtrl+C để tắt. Đóng tab trình duyệt KHÔNG tắt công ty.',
  'cli.closing': '\nĐang đóng...',
  'cli.notRunning': 'Công ty không chạy.',
  'cli.stopSent': 'Đã gửi yêu cầu tắt tới pid {pid}.',
  'cli.daemonError':
    'Daemon trả về lỗi {status}. Nếu bạn vừa nâng cấp agentco, chạy `agentco stop` rồi `agentco start` lại.',
  'cli.daemonMismatch':
    'Daemon đang chạy một phiên bản khác với CLI này.\nChạy:  agentco stop   rồi   agentco start',
  'cli.companyFallback': 'Công ty',
  'cli.notRunningStart': 'Công ty không chạy.\nBật bằng:  agentco start',
  'cli.noOffices': '  chưa có văn phòng nào',
  'cli.officeStatusLine': '  {name} {state} {agents} nhân viên · {notes} ghi chú',
  'cli.noOfficesPlain': 'Chưa có văn phòng nào.',
  'cli.officeNameMissing': 'Thiếu tên văn phòng.\nVí dụ:  agentco office new "Nội dung"',
  'cli.officeCreated': 'Đã tạo văn phòng "{name}" ({id}).',
  'cli.officeIdMissing': 'Thiếu mã văn phòng.\nVí dụ:  agentco office {sub} noi-dung',
  'cli.officeArchived': 'Đã cất văn phòng "{id}" vào lưu trữ. Khôi phục: agentco office restore {id}',
  'cli.officeRestored': 'Đã khôi phục văn phòng "{id}".',
  'cli.officeRmMissing': 'Thiếu mã văn phòng.\nVí dụ:  agentco office rm noi-dung',
  'cli.officeRmWarn':
    'Xoá hẳn văn phòng "{id}": mất toàn bộ nhân viên, kỹ năng, kho tri thức và kết quả.\nKhông lấy lại được.\n\n  Muốn cất đi rồi lấy lại sau:  agentco office archive {id}\n  Chắc chắn xoá hẳn:            agentco office rm {id} --yes',
  'cli.officeRemoved': 'Đã xoá hẳn văn phòng "{id}" và toàn bộ file.',
  'cli.officeNoSub':
    'Không có lệnh "office {sub}".\nDùng: office list | office new "Tên" | office archive <id> | office restore <id> | office rm <id> --yes',
  'cli.noSecrets': 'Chưa có bí mật nào.\nThêm bằng:  $env:VALUE="..."; agentco secret set TÊN_KHOÁ',
  'cli.secretsHeader': 'Bí mật đã lưu (chỉ hiện TÊN):',
  'cli.secretsGrant': '\nCấp cho nhân viên bằng cách thêm vào roles/<id>.yaml:  secrets: [TÊN_KHOÁ]',
  'cli.secretNameShape':
    'Tên bí mật phải VIẾT HOA, chỉ chữ/số/gạch dưới.\nVí dụ:  agentco secret set NOTION_TOKEN',
  'cli.secretMissing': 'Không có bí mật "{name}".',
  'cli.secretRemoved': 'Đã xoá "{name}". Nhân viên nào đang khai nó sẽ báo thiếu chìa ở lần chạy tới.',
  'cli.secretNoValue':
    'Thiếu giá trị. Đặt qua biến môi trường VALUE để nó không lọt vào lịch sử shell:\n  PowerShell:  $env:VALUE="dán-khoá-vào-đây"; agentco secret set {name}\n  bash:        VALUE=\'dán-khoá-vào-đây\' agentco secret set {name}',
  'cli.secretSaved': 'Đã lưu "{name}" vào .state/secrets.json (không commit, không đi qua HTTP).',
  'cli.secretNoSub': 'Không có lệnh "secret {sub}".\nDùng: secret list | secret set <TÊN> | secret rm <TÊN>',
  'cli.runMissing':
    'Thiếu nội dung công việc.\nVí dụ:  agentco run "viết 3 bài giới thiệu sản phẩm X" --office noi-dung',
  'cli.runHandedOver': 'Đã giao việc cho "{office}". Theo dõi ở {url}',
  'cli.planHeader': '\nKế hoạch:',
  'cli.noOfficeYet': 'Chưa có văn phòng nào.\nTạo bằng:  agentco office new "Tên văn phòng"',
  'cli.noSuchOffice': 'Không có văn phòng "{wanted}".\nĐang có: {list}',
  'cli.whichOffice':
    'Có {n} văn phòng, cần nói rõ giao cho ai.\nThêm:  --office <mã>\nĐang có: {list}',
  'cli.purgeNothing': 'Sổ không có mục nào "không còn" — không phải dọn gì.\n',
  'cli.purgeDone': 'Đã dọn {offices} mục không còn · {tasks} việc · {cost}\n',
  'cli.costByOffice': '\nTheo văn phòng:',
  'cli.costLine': '  {name} {tasks} việc · {turns} lượt · {cost}',
  'cli.prefixLine': '  {role} {key}  ~{tokens} token tĩnh',
  'cli.checkNode': 'Node ≥ 22',
  'cli.checkNodeNote': 'đang dùng {version}',
  'cli.checkCompanyDir': 'Thư mục công ty',
  'cli.checkWritable': 'Quyền ghi',
  'cli.checkOffices': 'Văn phòng',
  'cli.checkOfficesNone': 'chưa có văn phòng nào — tạo trong giao diện',
  'cli.checkOfficesBroken': '{broken}/{total} lỗi: {list}',
  'cli.checkOfficesOk': '{n} văn phòng, đều nạp được',
  'cli.unknownError': 'lỗi không rõ',
  'cli.checkAuth': 'Đăng nhập Claude Code',
  'cli.checkAuthOk': 'gọi thử thành công',
  'cli.checkAuthHint': 'chạy `claude` một lần để đăng nhập',
  'cli.checkAuthTimeout': 'không có phản hồi sau {seconds} s — kiểm tra mạng, rồi chạy `claude` một lần để đăng nhập',
  'cli.checkDaemon': 'Daemon',
  'cli.checkDaemonNo': 'không chạy — `agentco start`',
  'cli.createdShortcutHint': '  Muốn nó nằm trong menu ứng dụng? Chạy `agentco shortcut` ở đây.',
  'cli.updateRestarting': 'Bản {version} đã vào chỗ — đang khởi động lại trên cùng cổng.',
  'srv.updateNotPackaged':
    'Bản này cài bằng npm, nên cập nhật bằng `agentco update` chứ không phải từ đây.',
  'srv.updateBusy': 'Đang có một lượt cập nhật chạy rồi.',
  'srv.updateOfficeBusy':
    'Chưa cập nhật khi còn việc đang chạy — {offices} đang làm. Cập nhật sẽ tắt công ty, mà việc bị tắt giữa chừng sẽ được ghi là thất bại, tức là đổ lỗi cho công việc vì chuyện do bản cập nhật gây ra.\nĐợi nó xong, hoặc bấm Dừng, rồi cập nhật.',
  'srv.updateNoNpm':
    'Không tìm thấy npm cạnh Node này nên không có gì để giao việc. Không có gì bị tắt cả.',
  'cli.versionNpm': '  cài bằng npm',
  'cli.versionPackaged': '  cài bằng bản cài đặt',
  'cli.versionRemoveNpm':
    '  gỡ bằng:  npm uninstall -g {package}    (thư mục công ty ở lại — đó là dữ liệu của bạn)',
  'cli.versionRemovePackaged':
    '  gỡ ở:     Settings → Apps → AgentCo    (thư mục công ty ở lại — đó là dữ liệu của bạn)',
  'cli.updatePackaged':
    'Bản này đến từ trình cài, không phải từ npm, nên `agentco update` không phải cửa của nó.\nTải bản mới ở {url} rồi cài đè lên bản này — thư mục nó đề nghị chính là thư mục bạn đang dùng.',
  'cli.updateAlready': 'Đang ở {version}, và đó là bản mới nhất.',
  'cli.updateNoNpm':
    'Không tìm thấy npm cạnh Node này nên không có gì để giao việc. Công ty **chưa** bị tắt.\nTự cập nhật bằng:  {command}',
  'cli.updateHandedOff': 'Đang cài {target} ở một tiến trình riêng, xong sẽ bật lại công ty.',
  'cli.updateHandedOffIdle': 'Đang cài {target} ở một tiến trình riêng.',
  'cli.updateStarting': 'Đang cài {target}, xong sẽ bật lại công ty.',
  'cli.updateStartingIdle': 'Đang cài {target}.',
  'cli.updateLog': '  tiến trình và lỗi nếu có:  {path}',
  'cli.updateNoSpace':
    'Không đủ chỗ trống để cài, nên chưa đụng vào gì cả — công ty vẫn nguyên và vẫn chạy được.\nCài cần khoảng {need} trống; "{dir}" còn {free}.\nDọn bớt chỗ rồi thử lại. `npm cache clean --force` thường là chỗ lấy lại được nhiều nhất.',
  'cli.portMoved':
    '  Cổng {from} đang bận nên công ty chuyển sang {to} — đã ghi vào runtime.port trong {file}.',
  'cli.portBusy': 'Cổng {port} đang được thứ khác dùng, nên công ty này chưa khởi động.',
  'cli.portBusyAgentco':
    'Ở đó là một công ty agentco khác (bản {version}) — nhiều khả năng là bản cài desktop, nó giữ công ty riêng. Nó đang mở ở {url}',
  'cli.portBusyAsked':
    'Cổng này do bạn chỉ định bằng --port nên không tự đổi và không ghi gì cả. Đang trống lúc này: {next}',
  'cli.portBusyNoneFree':
    'Các cổng phía trên cũng không còn chỗ trống. Đóng bớt thứ đang giữ chúng, hoặc sửa runtime.port trong {file} — {next} là cổng đáng thử tiếp.',
  'cli.portBusyUnknownAgentco':
    'Trên cổng đó là một bản agentco cũ (bản {version}), nó không khai đang phục vụ công ty nào. Công ty này KHÔNG được dời, phòng khi hai bên là cùng một thư mục. Cập nhật bản kia, hoặc chạy công ty này bằng --port {next}.',
  'cli.alreadyRunningAtPort':
    'Công ty này đang chạy sẵn ở {url} — đang mở ra. (Bản ghi daemon bị mất, nên hãy dùng nút “Tắt hẳn” trong tab thay vì `agentco stop`.)',
  'cli.shortcutNotLinux':
    'Hiện chỉ tạo lối tắt trong menu trên Linux.\nTrên Windows, icon đến từ bản cài ở agent-co.app; nếu cài bằng npm thì khởi động công ty bằng `agentco start`.\nTrên macOS không có lối tắt menu ở cả hai đường — `agentco start` là đường vào.',
  'cli.shortcutNoCompany': 'Không có công ty nào ở {dir}.\nChạy `agentco init` ở đó trước, rồi `agentco shortcut`.',
  'cli.shortcutCreated': 'Đã thêm “{name}” vào menu ứng dụng.\n  {file}',
  'cli.shortcutNodeNote': 'Lối tắt chạy bằng Node {version}. Nếu đổi phiên bản Node, chạy lại `agentco shortcut`.',
  'cli.launchFailedTitle': 'AgentCo không bật được',
  'cli.help': `agentco — một công ty ảo chạy trên máy bạn

agentco init                   Tạo công ty mới (RỖNG) trong ./company
agentco start                  Bật công ty + mở giao diện  (chạy lại là mở lại tab)
agentco stop                   Tắt hẳn daemon
agentco status                 Xem công ty và các văn phòng

agentco office list            Liệt kê văn phòng
agentco office new "Tên"       Tạo văn phòng mới (kèm Trợ lý, chưa có nhân viên)
agentco office rm <mã>         Đóng văn phòng  (thêm --delete-files để xoá hẳn)

agentco secret list            Xem TÊN các chìa khoá đã lưu (không hiện giá trị)
agentco secret set <TÊN>       Lưu một chìa  (giá trị qua biến môi trường VALUE)
agentco secret rm <TÊN>        Xoá một chìa

agentco run "<việc>"           Giao một việc  (--office <mã> khi có nhiều văn phòng)
agentco cost [--since 7d]      Xem đã tốn bao nhiêu  (--office <mã> để lọc)
agentco cost --purge           Dọn các mục "không còn" khỏi sổ (văn phòng đã xoá)
agentco version                Đang chạy bản nào, và bản nằm ở đâu
agentco doctor                 Kiểm tra máy đã sẵn sàng chưa
agentco update [--to <bản>]    Cài bản mới nhất rồi bật lại  (cho bản cài bằng npm)
agentco shortcut               Thêm công ty này vào menu ứng dụng (Linux)

Tuỳ chọn chung:  --dir <path>  --port <n>  --host <ip>  --no-ui

Đóng tab trình duyệt KHÔNG tắt công ty. Muốn tắt hẳn: nút "Tắt hẳn" hoặc \`agentco stop\`.`,


  // ──────────────────────────────────────────────────── daemon / HTTP API
  'company.unnamed': 'Công ty của tôi',
  'company.unnamedOffice': 'Văn phòng mới',
  /*
   * `seed.assistantSkills.body` is gone (05/09). Its Vietnamese value opened
   * with a PRONOUN ORDER that has no counterpart in the English one and can
   * only be obeyed in one language — which is how the interface switch ended
   * up steering the assistant's replies. → `en.ts`, same spot
   */
  /*
   * `seed.rolePitchDefault` is gone too (05/09), for the same reason one layer
   * down: it became a worker's `pitch`, which the assistant routes on and which
   * lives in the cached prefix. → `en.ts`, same spot
   */
  'seed.mainOfficeName': 'Văn phòng chính',
  'seed.assistantName': 'Trợ lý',
  'srv.missingField': 'thiếu "{field}"',
  'srv.badToken': 'sai token',
  'srv.hostNotAllowed': 'Host không được phép',
  'srv.crossOrigin': 'yêu cầu đến từ trang khác — đã chặn',
  'srv.noOffice': 'không có văn phòng này',
  'srv.noPlan': 'không có công việc này',
  'srv.noRole': 'không có vai trò này',
  'srv.noDoc': 'không có tài liệu này',
  'srv.noDocOrOriginal': 'không có tài liệu này, hoặc bản gốc đã mất',
  'srv.noArtifact': 'không có kết quả này',
  'srv.noRoute': 'không có route này',
  'srv.armFieldsMissing': 'thiếu "config", "catalogId" hoặc "armId"',
  'srv.catalogOrAccountMissing': 'thiếu "catalogId" hoặc "account"',
  'srv.loopbackOption':
    '"{label}" chỉ bật được khi trình duyệt và daemon nằm trên cùng một máy. Cửa sổ mở ra ở nơi daemon chạy — và container tính là một máy khác, nên chạy bằng Docker thì không ai nhìn thấy nó.',
  'srv.probeListFailed':
    'Không nối được để đọc danh sách việc: {reason}. Cánh tay có giới hạn quyền không cắm được khi chưa biết việc nào thuộc nấc nào.',
  'srv.noToolsAtTier':
    'Server trả {n} việc nhưng KHÔNG việc nào thuộc mức quyền này. Nhiều khả năng server không khai annotations — chọn mức cao hơn, hoặc tự chọn từng việc.',
  'srv.bindRefused':
    'Từ chối bind {host} khi chưa có token đăng nhập.\nMở cổng này ra mạng nghĩa là cho người lạ chạy lệnh trên máy bạn.\nĐặt AGENTCO_TOKEN=<chuỗi bí mật> rồi thử lại.',
  'srv.connected': 'Đã kết nối {name}.',
  'srv.browserLoginLocalOnly':
    'Cửa sổ đăng nhập chỉ mở khi trình duyệt và daemon nằm trên cùng một máy — nó sẽ bật lên ở nơi daemon chạy, và container tính là một máy khác, nên chạy bằng Docker thì không có gì để nhìn.',
  'srv.previewTooBig': 'File nặng {mb}MB, quá lớn để xem trước. Tải về để mở.',
  'srv.bodyNotJson': 'Dữ liệu gửi lên không phải JSON hợp lệ.',
  'srv.uploadTooBig':
    'File vượt trần {mb}MB. Đổi trần ở company.yaml (library.max_file_mb) nếu bạn thật sự cần.',

  'srv.notBuiltTitle': 'AgentCo — chưa build giao diện',
  'srv.notBuiltH1': 'Giao diện chưa được build',
  'srv.notBuiltRun': 'Daemon đang chạy bình thường — chỉ thiếu phần giao diện. Chạy một lần:',
  'srv.notBuiltFromRoot': 'Hoặc từ thư mục gốc:',
  'srv.notBuiltReloadBefore': 'Rồi tải lại trang này. API vẫn hoạt động, nên',
  'srv.notBuiltReloadAfter': 'ở terminal dùng được ngay.',

  // ────────────────────────────────────────────────────── OAuth sign-in
  'srv.oauthLoopbackHost':
    'Daemon đang lắng nghe ở "{host}", nên "http://127.0.0.1" KHÔNG phải địa chỉ người dùng gõ vào trình duyệt — dịch vụ sẽ trả mã uỷ quyền về nhầm máy.\nKhai địa chỉ thật rồi thử lại:\n{hint}\nhoặc đặt runtime.public_url trong company.yaml.',
  'srv.oauthPublicUrlInvalid': 'runtime.public_url không phải URL hợp lệ: "{raw}"',
  'srv.oauthPublicUrlScheme': 'runtime.public_url phải là http hoặc https, đang là "{scheme}"',
  'srv.oauthPublicUrlInsecure':
    'runtime.public_url dùng http:// cho một địa chỉ ngoài máy này ("{host}").\nMã uỷ quyền sẽ đi qua mạng ở dạng chữ thường — bất kỳ ai đứng giữa cũng đổi được nó ra chìa.\nDùng https, hoặc đưa nginx/Caddy lên trước để nó lo TLS.',
  'srv.oauthPublicUrlQuery': 'runtime.public_url không được có "?" hay "#": "{raw}"',
  'srv.oauthNotLoginService': '"{id}" không phải dịch vụ đăng nhập được.',
  'srv.oauthNoLoginNeeded': '{url} không cần đăng nhập — cắm thẳng được.',
  'srv.oauthPageFailedTitle': 'Chưa nối được',
  'srv.oauthPageFailedBody': 'Dịch vụ trả về: {error}. Quay lại agentco và thử lại nhé.',
  'srv.oauthPageExpiredTitle': 'Lượt đăng nhập đã hết hạn',
  'srv.oauthPageExpiredBody': 'Quay lại agentco và bấm Đăng nhập lần nữa.',
  'srv.oauthPageNoCodeTitle': 'Thiếu mã uỷ quyền',
  'srv.oauthPageNoCodeBody': 'Dịch vụ không gửi mã về. Thử lại từ agentco.',
  'srv.oauthPageExchangeTitle': 'Chưa đổi được mã lấy chìa',
  'srv.oauthPageDoneTitle': 'Đã kết nối',
  'srv.oauthPageDoneBody': '{who} giờ dùng được trong agentco.',
  'srv.oauthPageDoneFallbackWho': 'Tài khoản của bạn',
  'srv.oauthPageSaveFailedTitle': 'Chưa lưu được tài khoản',
  'srv.oauthNotAClientId':
    'Chuỗi này trông không giống một Client ID. Client ID là dữ liệu công khai và ngắn (GitHub App: dạng "Iv23li…"). Đừng dán client secret hay private key vào đây.',
  'srv.oauthNoDeviceLogin': '"{id}" không đăng nhập bằng mã thiết bị.',
  'srv.oauthDeviceGone':
    '{issuer} không còn hỗ trợ đăng nhập bằng mã thiết bị — mục danh mục này cần cập nhật.',
  'srv.oauthNoIdentityYet':
    'Đã cấp quyền xong, nhưng chưa lấy được danh tính riêng của tài khoản {who} nên chưa lưu được — lưu bây giờ thì tài khoản này sẽ đè lên một tài khoản {who} khác. Bấm Đăng nhập một lần nữa; lượt sau thường chạy ngay.',
  'srv.oauthNoIdentityTwice':
    'Không hỏi được danh tính tài khoản ({name}) sau 2 lượt — KHÔNG lưu chìa, vì thiếu danh tính thì hai tài khoản của cùng dịch vụ này sẽ gộp làm một.',
  'srv.oauthSessionExpired': 'Lượt đăng nhập đã hết hạn — bấm Đăng nhập lần nữa.',
  'srv.oauthUnnamed': '(chưa đặt tên)',
  'srv.oauthKeyDead': 'Chìa "{label}" không còn hiệu lực — cần đăng nhập lại. {detail}',
  'srv.oauthNoAccount': 'Không có tài khoản "{name}".',
  'srv.oauthAccountInUse':
    '"{label}" vẫn đang được {n} kết nối dùng ({who}). Gỡ những kết nối đó trước — gỡ tài khoản trước là để lại một cánh tay chết im.',

  // ────────────────────────────────────────────────── live activity line
  'activity.reading': 'đang đọc yêu cầu…',
  'activity.assistantThinking': 'Trợ lý đang nghĩ…',
  'activity.assistantPlanning': 'Trợ lý đang lập kế hoạch…',
  'activity.running': 'Đang chạy…',

  // ──────────────────────────────────────────────────────────── toasts
  'toast.unusedArms': '{n} kết nối giờ không ai dùng — dọn ở Tổng quan → Kết nối.',
  'toast.badEdge': 'Sơ đồ không nhận sợi dây đó — kiểu nối này không hợp lệ.',

  // ────────────────────────────────────── pasted-JSON diagnosis (json-paint)
  'jsonHint.notJson': 'Đây không phải khối JSON — nó phải mở đầu bằng `{`.',
  'jsonHint.missingBrace': 'Thiếu {n} dấu `}` ở cuối — có vẻ bạn chưa dán hết.',
  'jsonHint.missingBracket': 'Thiếu {n} dấu `]` ở cuối — có vẻ bạn chưa dán hết.',
  'jsonHint.extraBrace': 'Thừa {n} dấu `}`.',
  'jsonHint.extraBracket': 'Thừa {n} dấu `]`.',
  'jsonHint.unclosedQuote': 'Có một dấu nháy kép `"` chưa đóng.',
  'jsonHint.singleQuote': 'JSON chỉ nhận nháy kép `"`, không nhận nháy đơn `\'`.',
  'jsonHint.trailingComma': 'Thừa một dấu phẩy — JSON không cho dấu phẩy trước `}` hoặc `]`.',
  'jsonHint.propName': 'Tên trường phải nằm trong dấu nháy kép, ví dụ `"command"`.',
  'jsonHint.missingColon': 'Thiếu dấu `:` sau tên trường.',
  'jsonHint.missingComma': 'Thiếu dấu `,` giữa hai mục.',
  'jsonHint.badChar': 'Ký tự `{char}` ở đây không hợp lệ.',
  'jsonHint.unreadable': 'Chỗ này không đọc được.',

  // ────────────────────────────────────────────────────────── canvas nodes
  'node.library': 'Tủ tài liệu',
  'node.libraryBusy': 'đang đọc {n} tài liệu…',
  'node.libraryHint': 'thả file vào đây',
  'node.knowledge': 'Kho tri thức chung',
  'node.knowledgeHint': 'bấm để mở',
  'node.armMissing': 'không còn cắm',
  'node.armKeyDead': 'cần đăng nhập lại',
  'node.armKeyGone': 'chưa có chìa',
  'node.armFallback': 'kết nối',
  'node.roleMissing': 'không tìm thấy vai trò',
  'node.resting': 'đang nghỉ',
  'canvas.cutEdge': 'Ngắt dây',

  // ─────────────────────────────────────────────── CLI command sample/form
  'cliForm.helloGreeting': 'Xin chào, ',
  'cliForm.helloSay': 'nói xin chào',
  'cliForm.helloDescription':
    'In ra một lời chào kèm tên được đưa vào. Chỉ in ra màn hình, không đọc và không ghi file nào — chạy lại bao nhiêu lần cũng an toàn.',
  'cliForm.noName': 'Chưa đặt tên cho lệnh này.',
  'cliForm.noLine': 'Chưa có dòng lệnh nào để chạy.',

  // ───────────────────────────────────────────────────────────── markdown
  'md.taskDone': 'đã xong: ',
  'md.taskTodo': 'chưa xong: ',

  // ────────────────────────────────────────────────────────────── sidebar
  'sidebar.chat': 'Nói với Trợ lý',
  'sidebar.plans': 'Nhật ký công việc',
  'sidebar.overview': 'Tổng quan công ty',
  'sidebar.library': 'Tủ tài liệu',
  'sidebar.artifacts': 'Kết quả',
  'sidebar.knowledge': 'Kho tri thức',
  'sidebar.settings': 'Cài đặt',
  'sidebar.closePanel': 'Đóng bảng',
  'sidebar.resizeHandle': 'Kéo để đổi bề rộng bảng',
  'sidebar.resizeHint': 'Kéo để đổi bề rộng · nhấp đúp để về mặc định',
  'sidebar.widen': 'Mở rộng bảng',
  'sidebar.widenHint': 'Mở rộng bảng',
  'sidebar.narrow': 'Thu hẹp bảng',
  'sidebar.narrowHint': 'Thu về bề rộng thường',

  // ───────────────────────────────────────────────────────────── settings
  'settings.title': 'Cài đặt',
  'settings.language': 'Ngôn ngữ giao diện',
  'settings.theme': 'Màu giao diện',
  'settings.themeLight': 'Sáng',
  'settings.themeDark': 'Tối',

  // ────────────────────────────────────────────────────────────── dialogs
  'dialog.newOffice.title': 'Tạo văn phòng',
  'dialog.newOffice.name': 'Tên văn phòng',
  'dialog.newOffice.placeholder': 'Ví dụ: Nội dung, Kế toán, Hỗ trợ khách hàng',
  'dialog.renameOffice.title': 'Đổi tên văn phòng',
  'dialog.renameOffice.descBefore': 'Chỉ đổi tên hiển thị. Mã văn phòng',
  'dialog.renameOffice.descAfter':
    '— cũng là tên thư mục chứa toàn bộ kết quả và lịch sử — giữ nguyên.',
  'dialog.renameOffice.newName': 'Tên mới',
  'dialog.renameOffice.unique':
    'Không được trùng tên với văn phòng khác — hai dòng y hệt nhau trong ô chọn là cách chắc chắn nhất để gõ nhầm chỗ.',
  'dialog.newAgent.title': 'Thêm nhân viên',
  'dialog.newAgent.name': 'Tên hiển thị',
  'dialog.newAgent.namePlaceholder': 'Ví dụ: Người dựng bảng tính',
  'dialog.newAgent.pitch': 'Giới thiệu',
  'dialog.newAgent.pitchPlaceholder': 'Làm được việc gì, đầu ra là gì',
  'dialog.newAgent.pitchTip': 'Tip: giữ ngắn gọn.',
  'dialog.newAgent.tier': 'Mức model',
  'dialog.newAgent.tierStandard': 'standard — cân bằng',
  'dialog.newAgent.tierEco': 'eco — rẻ hơn',
  'dialog.newAgent.tierDeep': 'deep — chỉ cho việc thật khó',

  // ────────────────────────────────────────────────── company overview
  'overview.offices': 'Văn phòng',
  'overview.folderTip': 'Thư mục trên đĩa — offices/{id}/',
  'overview.folderAria': 'Thư mục của {name}',
  'overview.opened': 'Đã mở: {dir}',
  'overview.remoteCopied': 'Đang xem từ máy khác nên không mở được — đã chép đường dẫn: {dir}',
  'overview.archiveTip': 'Lưu trữ',
  'overview.archiveAria': 'Cất văn phòng {name} vào lưu trữ',
  'overview.deleteTip': 'Xoá',
  'overview.deleteOfficeAria': 'Xoá hẳn văn phòng {name}',
  'overview.noOffices': 'chưa có văn phòng nào đang mở',
  'overview.archived': 'Trong lưu trữ',
  'overview.readOnly': 'chỉ đọc',
  'overview.restore': 'Khôi phục',
  'overview.costTitle': 'Chi phí cả công ty',
  'overview.noCost': 'Chưa có việc nào được ghi nhận.',
  'overview.turnsNoteBefore': 'Số',
  'overview.turnsNoteBold': 'lượt',
  'overview.turnsNoteAfter': 'là đòn bẩy chi phí lớn nhất.',
  'overview.armForgotten': 'Đã xoá "{label}". Chìa vẫn được giữ.',
  'overview.accountForgotten': 'Đã gỡ "{name}".',
  'overview.connections': 'Kết nối',
  'overview.usedBy': 'dùng bởi: {who}',
  'overview.unused': 'không ai dùng',
  'overview.onCanvasNotWired': 'có trên sơ đồ, chưa nối dây',
  'overview.dropArmTip': 'Xoá hẳn khỏi sổ chung — chìa vẫn được giữ',
  'overview.dropArmAria': 'Xoá hẳn kết nối {label}',
  'overview.accounts': 'Tài khoản đã nối',
  'overview.keyDead': 'chìa đã chết — phải đăng nhập lại',
  'overview.accountUnused': 'không kết nối nào dùng',
  'overview.accountBlockedTip': 'Còn {n} kết nối dùng ({who}) — xoá chúng ở mục Kết nối trước',
  'overview.accountDropTip': 'Gỡ workspace này — thu hồi quyền ở phía dịch vụ',
  'overview.accountDropAria': 'Gỡ workspace {label}',
  'overview.dropArmTitle': 'Xoá hẳn kết nối “{label}”?',
  'overview.dropArmBody1': 'Nó rời sổ chung của công ty và',
  'overview.dropArmBodyBold': 'không lấy lại được',
  'overview.dropArmBody2': '— cắm lại là dựng từ danh mục.',
  'overview.dropArmKeepBold': 'Chìa vẫn được giữ:',
  'overview.dropArmKeepAfter': 'cắm lại thì không phải đi lấy token lần nữa.',
  'overview.dropAccTitle': 'Gỡ workspace “{label}”?',
  'overview.dropAccBody1': 'Xoá chìa trên máy này. Muốn dùng lại thì phải',
  'overview.dropAccBodyBold': 'đăng nhập lại từ đầu',
  'overview.dropAccBody2': 'ở trang của hãng.',
  'overview.drop': 'Gỡ',
  'overview.purged': 'Đã dọn {n} mục · {cost}',
  'overview.purgeFailed': 'Dọn không thành',
  'overview.goneEntries': 'mục không còn ·',
  'overview.tapToSee': 'bấm để xem',
  'overview.purging': 'Đang dọn…',
  'overview.purgeAll': 'Dọn hết',
  'overview.purgeTitle': 'Dọn {n} mục không còn khỏi sổ chi phí?',
  'overview.purgeBodyMid': 'sẽ biến khỏi mọi báo cáo, và',
  'overview.purgeBodyBold': 'không có nút hoàn tác',
  'overview.purgeUntouchedBefore': 'Văn phòng đang mở và văn phòng trong lưu trữ',
  'overview.purgeUntouchedBold': 'không',
  'overview.purgeUntouchedAfter': 'bị đụng.',
  'overview.archivedSuffix': '(lưu trữ)',
  'overview.archivedAgents': 'Nhân viên trong lưu trữ',
  'overview.restoreTipOffice':
    'Trở lại sơ đồ của "{name}", đứng ở một chỗ trống — không đè lên ai. Vẫn ở trạng thái NGHỈ cho tới khi bạn nối dây.',
  'overview.restoreTip': 'Trở lại sơ đồ, đứng ở một chỗ trống, vẫn ở trạng thái nghỉ.',
  'overview.bringBack': 'Đưa trở lại',
  'overview.deleteRoleTip': 'Xoá hẳn file vai trò — không lấy lại được',
  'overview.deleteAgentAria': 'Xoá hẳn {label}',
  'overview.bringBackNoteBefore': 'Đưa trở lại là họ xuất hiện trên sơ đồ của',
  'overview.bringBackNoteMid':
    'ở một chỗ trống — không bao giờ nằm đè lên người khác, kể cả khi đã có ai ngồi vào chỗ cũ của họ. Trạng thái vẫn là',
  'overview.bringBackNoteBold': 'đang nghỉ',
  'overview.bringBackNoteAfter': 'cho tới khi bạn nối dây từ Trợ lý.',
  'overview.thisOffice': 'văn phòng này',
  'overview.atPath': 'ở',
  'overview.notesKeptShort': 'vẫn được giữ.',
  'overview.modelsTitle': 'Model của công ty',
  'overview.masterTier': 'Trợ lý chạy mức',
  'overview.plannerTier': 'Lập kế hoạch chạy mức',
  'overview.modelNamesBefore': 'Tên model phải đúng như Anthropic đặt (',
  'overview.modelNamesAfter':
    '…). Gõ sai thì việc đầu tiên chạy sau đó sẽ báo lỗi model không tồn tại — không có gì hỏng vĩnh viễn, sửa lại là chạy tiếp.',
  'overview.modelsWideBefore': 'Đổi ở đây đụng tới',
  'overview.modelsWideBold': 'mọi văn phòng',
  'overview.modelsWideAfter':
    '. Việc đang chạy giữ nguyên model cũ cho tới khi xong; mọi thứ sau đó dùng model mới và phải ghi lại bộ nhớ đệm một lần.',
  'overview.removeOfficeTitle': 'Xoá hẳn văn phòng “{name}”?',
  'overview.removeOfficeBefore': 'Xoá cả thư mục',
  'overview.removeOfficeAfter': ': nhân viên, kỹ năng, kho tri thức và mọi kết quả đã làm.',
  'overview.removeNoUndo': 'Không lấy lại được.',

  // ────────────────────────────────────────────── inspector (right panel)
  'inspector.editProfile': 'Sửa hồ sơ',
  'inspector.displayName': 'Tên hiển thị',
  'inspector.pitch': 'Giới thiệu',
  'inspector.renameAssistant': 'Đổi tên Trợ lý',
  'inspector.assistantNamePlaceholder': 'Ví dụ: Quản lý, Chị Lan, Điều phối viên',
  'inspector.assistantNameNoteBefore': 'Chỉ là cái tên trên sơ đồ và trong khung chat. Trợ lý',
  'inspector.assistantNameNoteBold': 'vẫn nhớ nguyên',
  'inspector.assistantNameNoteAfter': 'mọi thứ đã nói, và không có gì phải chạy lại.',
  'inspector.browserLoginTitle': 'Đăng nhập / thêm cookie',
  'inspector.browserOpenedBefore':
    'Cửa sổ đã mở. Dùng như trình duyệt bình thường — đăng nhập, chờ mã SMS, xác minh hai bước.',
  'inspector.browserOpenedBold': 'Đóng cửa sổ',
  'inspector.browserOpenedAfter': 'khi hoàn tất; nhân viên ghi nhớ lại phiên đó ở những lượt sau.',
  'inspector.browserIdleBefore': 'Mở một cửa sổ trình duyệt thường, dùng',
  'inspector.browserIdleBold': 'đúng hồ sơ',
  'inspector.browserIdleAfter':
    'mà nhân viên dùng. Đăng nhập ở đây một lần là những lượt việc sau nhân viên vào thẳng được.',
  'inspector.browserOpening': 'Đang mở…',
  'inspector.browserReopen': 'Mở lại',
  'inspector.browserOpen': 'Mở trình duyệt',
  'inspector.hideLog': 'Ẩn nhật ký',
  'inspector.showLog': 'Kết nối này đã làm gì?',
  'inspector.noCallsBefore':
    'Chưa có lời gọi nào được ghi. Nhật ký bắt đầu từ lúc kết nối được dùng trong một việc thật — bấm',
  'inspector.noCallsBold': 'Thử ngay',
  'inspector.noCallsAfter': 'lúc cắm thì không tính.',
  'inspector.argsTruncated': '\n\n… (đã cắt bớt — tham số quá dài)',
  'inspector.tier.eco': 'eco — rẻ nhất, chậm hơn và cần nhiều lượt hơn',
  'inspector.tier.standard': 'standard — cân bằng',
  'inspector.tier.deep': 'deep — chỉ cho việc thật khó, đắt hơn nhiều',
  'inspector.modelTier': 'Mức model',
  'inspector.model': 'Model',
  'inspector.perJobLimit': 'Giới hạn một việc',
  'inspector.maxUsd': 'tối đa ${n}',
  'inspector.noMoneyLimit': 'không giới hạn tiền',
  'inspector.changeModel': 'Đổi model',
  'inspector.changeModelLimits': 'Đổi model & giới hạn',
  'inspector.companyDefault': 'theo mặc định công ty ({default})',
  'inspector.limitOneJob': 'Giới hạn cho MỘT việc',
  'inspector.maxSpendHint': 'tiền tối đa ($) · 0 = không giới hạn',
  'inspector.maxStepsHint': 'số bước tối đa',
  'inspector.bashLabel': 'Cho chạy lệnh trên máy',
  'inspector.bashWarnBefore': 'Lệnh chạy bằng',
  'inspector.bashWarnBold': 'quyền của chính bạn',
  'inspector.bashWarnAfter':
    'trên máy này. Nhân viên chỉ được giao việc trong thư mục văn phòng, nhưng một câu lệnh thì không có hàng rào.',
  'inspector.armsInUse': 'Kết nối đang dùng',
  'inspector.reachableFolders': 'Thư mục với tới được',
  'inspector.level.read': 'chỉ đọc',
  'inspector.level.add': 'đọc + thêm mới',
  'inspector.level.full': 'toàn quyền',
  'inspector.onDuty': 'Đang trực',
  'inspector.offDuty': 'Đang nghỉ',
  'inspector.ownNotebook': 'Sổ tay riêng',
  'inspector.rosterNoteBefore':
    'Mỗi người đang trực chiếm một dòng giới thiệu trong ngữ cảnh của Trợ lý, ở',
  'inspector.rosterNoteBold': 'mọi',
  'inspector.rosterNoteAfter':
    'lượt trò chuyện. Ngắt kết nối nhân viên không dùng đến giúp tiết kiệm.',
  'inspector.viewPrompt': 'Xem prompt phân lớp',
  'inspector.type': 'Loại',
  'inspector.inUseBy': 'Đang dùng',
  'inspector.nobody': 'chưa ai',
  'inspector.missingArm': 'Không còn khai trong company.yaml.',
  'inspector.armKeyDead':
    'Dịch vụ đã từ chối chìa của "{who}". Nhân viên chưa dùng được kết nối này cho tới khi bạn đăng nhập lại — mở + Kết nối, chọn dịch vụ này, rồi bấm Đăng nhập lại ở đúng dòng tài khoản đó.',
  'inspector.removeFromOffice': 'Xoá khỏi văn phòng này',
  'inspector.removeFromOfficeShort': 'Xoá khỏi văn phòng',
  'inspector.roleId': 'Mã vai trò',
  'inspector.status': 'Trạng thái',
  'inspector.statusOnDuty': 'đang trực',
  'inspector.statusOffDuty': 'đang nghỉ',
  'inspector.missingRole': 'Không tìm thấy roles/{role}.yaml',
  'inspector.rest': 'Cho nghỉ',
  'inspector.backOnDuty': 'Cho trực lại',
  'inspector.archive': 'Cất vào lưu trữ',
  'inspector.deleteForGood': 'Xoá hẳn',
  'inspector.builtinNote':
    'Mọi nhân viên đã có sẵn: đọc/ghi file trong văn phòng, và tìm trên web.',
  'inspector.confirmRemoveArmTitle': 'Xoá “{label}” khỏi văn phòng này?',
  'inspector.confirmDeleteAgentTitle': 'Xoá hẳn “{label}”?',
  'inspector.armRemoveBody1':
    'Kết nối này biến khỏi sơ đồ, và những nhân viên đang nối tới nó thôi dùng được.',
  'inspector.armRemoveBold': 'Chỉ văn phòng này',
  'inspector.armRemoveBody2': '— nơi khác không bị chạm.',
  'inspector.armRemoveKeep1': 'Cấu hình và chìa khoá',
  'inspector.armRemoveKeepBold': 'vẫn được giữ',
  'inspector.armRemoveKeep2': '. Cắm lại đúng thứ này thì không phải nhập lại gì — chỉ mất công nối dây.',
  'inspector.agentNotesBefore': 'Sổ tay kinh nghiệm ở',
  'inspector.agentNotesAfter':
    'vẫn được giữ — đó là thứ văn phòng đã học được, không phải tài sản riêng của một cái tên.',
  'inspector.archiveHintBefore': 'Chỉ muốn cất đi cho gọn? Bấm',
  'inspector.archiveHintMid': 'rồi chọn',
  'inspector.archiveHintAfter': '— khôi phục được bất cứ lúc nào.',

  // ─────────────────────────────────────── connections: sign-in / scopes
  // ─────────────────────────────────────────── probing a connection
  'probe.noAccount':
    'Chưa nối tài khoản, hoặc kết nối đã bị gỡ ở phía dịch vụ. Bấm **Đăng nhập** rồi thử lại — không có ô chìa nào để điền cho loại này.',
  'probe.missingKeys': 'Thiếu chìa: {keys}.',
  'probe.notSentBecause':
    '{parts} Chưa gửi yêu cầu nào — gửi đi thì server chỉ trả về "sai chìa", và câu đó sẽ dắt bạn đi tìm nhầm chỗ.',
  'probe.zeroTools':
    'Nối được nhưng server không cấp việc nào. Thường là do một tuỳ chọn gửi lên bị server lặng lẽ bỏ qua — kiểm lại các nhóm việc đã tick.',
  'browserLogin.officeBusy':
    'Văn phòng đang chạy việc. Đợi xong (hoặc bấm dừng) rồi mở cửa sổ đăng nhập — trình duyệt chỉ mở được một lần cho mỗi hồ sơ.',
  'browserLogin.alreadyOpen': 'Cửa sổ đăng nhập của văn phòng này đang mở. Đóng nó rồi thử lại.',
  'browserLogin.badUrl': '"{url}" không phải một địa chỉ web hợp lệ.',
  'browserLogin.badScheme': 'Chỉ mở được địa chỉ http hoặc https.',
  'browserLogin.noBrowser':
    'Không tìm thấy Microsoft Edge hay Google Chrome trên máy này. Cài một trong hai rồi thử lại — cánh tay trình duyệt cũng dùng chính nó.',

  // ───────────────────────────────────────── CLI connection declaration
  'cliArm.exampleTooLong': 'ví dụ phải ngắn — nó nằm trong prefix mọi lượt',
  'cliArm.badId': 'id chỉ gồm chữ thường, số và gạch dưới',
  'cliArm.didYouMean': '"{key}" — ý bạn là "{near}"?',
  'cliArm.unknownKey': '"{key}" không có trong tờ khai',
  'cliArm.unknownKeys': 'Khoá không nhận ra: {list}',
  'cliArm.duplicateId':
    'Hai lệnh cùng mã "{id}" — mỗi lệnh phải có mã riêng. Mã suy từ ô Tên, nên hai tên gần giống nhau có thể ra cùng một mã: đổi tên một trong hai.',

  // ────────────────────────────────────── connection catalogue (arms/*.ts)
  'armCat.files.name': 'File trên máy',
  'armCat.files.blurb': 'Đọc file và thư mục trên chính máy này — chỉ những thư mục bạn cho phép.',
  'armCat.files.folders.label': 'Thư mục được phép',
  'armCat.files.folders.help':
    'Nhân viên chỉ với tới được những thư mục trong danh sách này. Chọn đúng thứ cần, đừng chọn cả ổ đĩa.',
  'armCat.browser.name': 'Trình duyệt web',
  'armCat.browser.blurb':
    'Mở và đọc trang web như một người dùng thật — kể cả hệ thống nội bộ không có API. Mặc định dùng trình duyệt sạch, không giữ đăng nhập, và chạy ẩn (không hiện cửa sổ).',
  'armCat.browser.keepSession.label': 'Nhớ đăng nhập',
  'armCat.browser.keepSession.help': 'Lưu session và cookie trình duyệt.',
  'armCat.browser.showWindow.label': 'Hiện cửa sổ trình duyệt',
  'armCat.browser.showWindow.help': 'Mở cửa sổ thật để bạn thấy nhân viên đang làm gì.',
  'armCat.github.name': 'GitHub',
  'armCat.linear.name': 'Linear',
  'armCat.notion.name': 'Notion',
  'armCat.github.repos.label': 'Repo & file',
  'armCat.github.pulls.label': 'Pull request',
  'armCat.github.issues.label': 'Issue',
  'armCat.github.actions.label': 'Actions / CI',
  'armCat.github.blurb':
    'Đọc và sửa file trong repo GitHub — kể cả repo riêng tư. Sửa là commit thẳng lên GitHub, không tải repo về máy. Repo riêng tư chỉ với tới được nếu bạn cài agentco vào.',
  'armCat.github.context.label': 'Tài khoản & tổ chức',
  'armCat.github.context.help':
    'Nhân viên biết bạn là ai trên GitHub, ở trong tổ chức và nhóm nào. Không đụng tới repo.',
  'armCat.github.repos.help':
    'Duyệt repo, đọc file, xem nhánh và commit. Ở nấc toàn quyền thì tạo và sửa file được.',
  'armCat.github.pulls.help': 'Xem, bình luận, tạo và gộp pull request.',
  'armCat.github.issues.help': 'Xem, tạo, gán người và đóng issue.',
  'armCat.github.actions.help': 'Xem lượt chạy workflow, đọc log, chạy lại một lượt hỏng.',
  'armCat.github.scopeSay': 'Chọn repo trên GitHub',
  'armCat.linear.blurb':
    'Đọc và (nếu bạn cho phép) ghi vào một workspace Linear — issue, project, tài liệu. Bạn chọn workspace nào ngay lúc đăng nhập.',
  'armCat.linear.tierAdd':
    'Đính kèm tệp và tạo nhãn mới. ⚠ KHÔNG mở được issue mới — Linear gộp việc tạo và việc sửa issue vào chung một lệnh, nên mở issue nằm ở nấc Toàn quyền.',
  'armCat.notion.blurb':
    'Tìm, đọc và (nếu bạn cho phép) ghi vào các trang Notion mà tài khoản của bạn xem được.',

  'arm.price.none': 'không cần chìa',
  'arm.price.keys': 'cần 1 chìa',
  'arm.price.login': 'cần đăng nhập',
  'arm.tier.read.name': 'Chỉ đọc',
  'arm.tier.read.help': 'Tìm và đọc. Không tạo, không sửa, không xoá gì cả.',
  'arm.tier.add.name': 'Đọc + Thêm mới',
  'arm.tier.add.help': 'Tạo được trang/mục mới, nhưng không đụng tới thứ đã có sẵn.',
  'arm.tier.full.name': 'Toàn quyền',
  'arm.tier.full.help': '⚠ Sửa và xoá nội dung đang có.',
  'arm.exPartsMismatch': 'Ví dụ có {b} mảnh, cú pháp có {a} — hai dòng này không cùng một lệnh.',
  'arm.exManyDiffsBefore':
    'Hai dòng khác nhau ở {n} chỗ. Chỗ nào thay đổi mỗi lần chạy thì đổi nó thành',
  'arm.exManyDiffsAfter': 'ở dòng Cú pháp.',
  'arm.exOneDiff1': 'Khác cú pháp ở',
  'arm.exOneDiff2': '. Nếu đây là chỗ thay đổi mỗi lần chạy, đổi nó thành',
  'arm.exOneDiff3': 'ở dòng Cú pháp — nhân viên sẽ điền vào đó.',
  'arm.jsonPlaceholder':
    'Dán khối cấu hình MCP từ README của server, ví dụ:\n{ "command": "npx", "args": ["-y", "..."] }',
  'arm.jsonAt': 'Dòng {line}, cột {col}: ',
  'arm.pluggedElsewhere': 'Đã cắm ở văn phòng khác',
  'arm.reuseIt': 'dùng lại',
  'arm.forgetTip': 'Xoá hẳn khỏi sổ chung',
  'arm.clientSaved':
    'Đã lưu. Lượt đăng nhập tới sẽ đi bằng app của bạn — tài khoản đã nối trước đó vẫn giữ nguyên.',
  'arm.clientCleared': 'Đã quay về app của agentco.',
  'arm.clientSaveFailed': 'Không lưu được Client ID.',
  'arm.dropFailed': 'Không gỡ được.',
  'arm.loginStopped': 'Lượt đăng nhập đã dừng.',
  'arm.codeExpired': 'Mã đăng nhập đã hết hạn — bấm Đăng nhập để lấy mã mới.',
  'arm.codeFailed': 'Không lấy được mã đăng nhập.',
  'arm.loginPageFailed': 'Không mở được trang đăng nhập.',
  'arm.needAccount': 'Đăng nhập một tài khoản trước đã.',
  'arm.needGroups': 'Tick ít nhất một nhóm việc trước đã.',
  'arm.needFolder': 'Chọn ít nhất một thư mục.',
  'arm.badConfig': 'Chưa đọc được cấu hình — kiểm lại khối JSON.',
  'arm.testFailed': 'Không thử được.',
  'arm.step1Title': 'Cắm một kết nối',
  'arm.step2Title': 'Cài đặt · {name}',
  'arm.step3Title': 'Ai được dùng?',
  'arm.step1Desc': 'Chọn một cái có sẵn, dùng lại cái đã cắm, hoặc dán cấu hình của riêng bạn.',
  'arm.step2Desc': 'Bấm Thử ngay để thử kết nối.',
  'arm.step3Desc': 'Kết nối chỉ hoạt động với người được nối dây tới nó.',
  'arm.typeFiles': 'Thư mục trên máy',
  'arm.typeFilesSay': 'chọn thư mục · không cần chìa',
  'arm.typeService': 'Dịch vụ có sẵn',
  'arm.typeServiceSay': '{n} dịch vụ · điền chìa',
  'arm.typeCliSay': 'bọc một lệnh bạn đã chạy được',
  'arm.typeCustom': 'Tự cắm MCP',
  'arm.typeCustomSay': 'dán cấu hình của bạn',
  'arm.back': '← Quay lại',
  'arm.noCatalogBefore': 'Chưa có dịch vụ dựng sẵn nào. Dùng',
  'arm.noCatalogBold': 'Tự cắm MCP',
  'arm.noCatalogAfter': '— nó nhận mọi server.',
  'arm.cliCwdTitle': 'Các lệnh sẽ chạy trong thư mục nào?',
  'arm.cliCwdBody':
    'Mọi lệnh của kết nối này đều chạy ở đúng một chỗ — thường là thư mục dự án bạn vẫn mở terminal trong đó.',
  'arm.pickFolder': 'Chọn thư mục…',
  'arm.officeFolder': 'thư mục văn phòng',
  'arm.cliCwdHintBefore': 'Bộ chọn mở sẵn ở',
  'arm.cliCwdHintAfter': '— bấm Xong ngay nếu lệnh của bạn không đụng tới file nào.',
  'arm.backToFolder': '← Thư mục',
  'arm.mixedCwdTip':
    'Tờ khai này đặt thư mục khác nhau cho từng lệnh — form chỉ giữ được một thư mục chung',
  'arm.viewJson': 'Xem JSON',
  'arm.backToForm': '← Về form',
  'arm.fillSample': 'Điền mẫu chạy thử',
  'arm.mixedCwd': 'Khác nhau theo từng lệnh',
  'arm.defaultCwd': 'Thư mục văn phòng (mặc định)',
  'arm.changeFolder': 'Đổi…',
  'arm.editInJson': 'sửa trong JSON',
  'arm.mixedCwdBefore': 'Tờ khai này đặt',
  'arm.mixedCwdBold': 'thư mục khác nhau cho từng lệnh',
  'arm.cliCommandN': 'Lệnh {n}',
  'arm.cliDrop': 'Bỏ',
  'arm.cliName': 'Tên',
  'arm.cliNamePlaceholder': 'đếm hoá đơn chưa thanh toán',
  'arm.cliDupBefore': 'Trùng tên với một lệnh khác (cùng ra mã',
  'arm.cliDupAfter': '). Nhân viên sẽ không phân biệt được hai lệnh này — đổi tên một trong hai.',
  'arm.cliSyntax': 'Cú pháp',
  'arm.cliExample': 'Ví dụ',
  'arm.cliExampleMismatch':
    'Ví dụ không khớp cú pháp — phải cùng số mảnh và giống hệt ở những chỗ không phải ô trống.',
  'arm.cliDescription': 'Miêu tả',
  'arm.cliDescriptionPlaceholder':
    'Nó làm gì, kết quả khi mong đợi chạy, có ghi đè không, hoàn tác được không',
  'arm.cliReadOnly': 'Lệnh chỉ đọc?',
  'arm.cliReadOnlyHint': 'Để trống nếu không chắc.',
  'arm.cliAdd': '+ Thêm lệnh',
  'arm.cliTooMany':
    'Hơn 8 việc trong một kết nối thì mỗi lượt làm việc đều phải cõng cả danh sách. Nên tách thành hai kết nối.',
  'arm.cliJsonBroken': 'Khối JSON đang hỏng — sửa xong mới lưu được.',
  'arm.cliDupIds': 'Hai lệnh cùng mã {ids} — mỗi lệnh phải có mã riêng.',
  'arm.cliProblemAt': 'Lệnh {n}: {say}',
  'arm.useThisConfig': 'Dùng cấu hình này',
  'arm.pasteIsCliBefore': 'Đây là tờ khai',
  'arm.pasteIsCliBold': 'lệnh',
  'arm.pasteIsCliAfter': ', không phải cấu hình MCP — nên tab này không dựng được nó.',
  'arm.openCliTab': 'Mở tab Lệnh với nội dung này →',
  'arm.multiServerBefore': 'Khối này có {n} server. Chỉ',
  'arm.multiServerMid': 'được cắm —',
  'arm.multiServerAfter': 'thì dán riêng thành một kết nối nữa.',
  'arm.pasteHintBefore': 'Nhận cả khối',
  'arm.pasteHintAfter': 'chép nguyên từ tài liệu.',
  'arm.connectionName': 'Tên kết nối',
  'arm.signIn': 'Đăng nhập',
  'arm.folderClash': 'Thư mục này đã là kết nối trong văn phòng này rồi.',
  'arm.folderFallbackLabel': 'Thư mục',
  'arm.oneFolderNote': 'Cần nhiều chỗ thì tạo thêm kết nối hoặc chọn thư mục cha.',
  'arm.noWorkspaceTitle': 'Chưa nối workspace nào',
  'arm.noWorkspaceBefore': 'Bấm nút dưới, chọn workspace rồi bấm',
  'arm.noWorkspaceMid': '. Tab sẽ tự đóng và quay lại đây.',
  'arm.noWorkspaceBold': 'Không cần copy gì cả.',
  'arm.useWorkspace': 'Dùng workspace',
  'arm.workspaceExpired': '⚠ Dịch vụ đã từ chối lượt đăng nhập này',
  'arm.reconnectedOther':
    'Bạn vừa đăng nhập bằng "{got}", nên đó là tài khoản đang được chọn. "{asked}" thì CHƯA được nối lại — bấm Đăng nhập lại ở đúng dòng của nó, và chọn đúng tài khoản đó ở trang của dịch vụ.',
  'arm.workspaceReconnectTip': 'Đăng nhập lại vào "{label}" — mọi kết nối đang dùng nó sống lại cùng lúc',
  'arm.workspaceInUse': 'Đang được dùng bởi: {who}. Gỡ kết nối đó trước.',
  'arm.workspaceDropTip': 'Gỡ workspace này',
  'arm.workspaceDropAria': 'Gỡ {label}',
  'arm.waitingApproval': 'Đang chờ bạn cho phép…',
  'arm.waitingClickAgain': 'Đang chờ… bấm để mở lại',
  'arm.addAnotherAccount': 'Nối thêm một tài khoản khác',
  'arm.addAnotherWorkspace': 'Nối thêm một workspace khác',
  'arm.signInWith': 'Đăng nhập với {name}',
  'arm.stopWaiting': 'Thôi chờ',
  'arm.tokensPerTurn': '~{n} token',
  'arm.tokensPerTurnSuffix': '· ~{n} token mỗi lượt',
  'arm.tierLabel': 'Cho nhân viên làm được gì',
  'arm.tierDeclared': '({server} tự khai mức của từng việc.)',
  'arm.serverFenceBefore': 'Số token ở trên đo khi',
  'arm.serverFenceBold': 'mở hết',
  'arm.serverFenceMid': '. Ở nấc này {name} cắt bớt việc ghi ngay từ server, nên thực tế',
  'arm.serverFenceBold2': 'tốn ít hơn',
  'arm.oneTierBefore': 'Kết nối này',
  'arm.oneTierAfter': '·',
  'arm.howItRuns': 'Cách chạy',
  'arm.remoteHiddenOption':
    'Một lựa chọn bị ẩn vì bạn đang xem từ máy khác — cửa sổ trình duyệt sẽ mở trên máy chạy agentco, nên từ đây bạn không nhìn thấy nó.',
  'arm.groupsLabel': 'Cho làm những nhóm việc nào',
  'arm.groupsRequired': 'Tick ít nhất một nhóm. Không nhóm nào thì kết nối này không làm được việc gì cả.',
  'arm.grantingBefore': 'Đang cấp',
  'arm.grantingAfter': 'mỗi lượt của nhân viên được nối',
  'arm.grantingUnknown': 'Bấm Thử ngay để biết bộ này cấp bao nhiêu việc và tốn bao nhiêu token.',
  'arm.envPlaceholderBefore': '↳ Cấu hình bạn dán có ô trống',
  'arm.envPlaceholderAfter': '. Giá trị lưu trong máy bạn, không ghi vào',
  'arm.reuseNothingTitle': 'Không phải điền lại gì cả',
  'arm.reuseBody': 'Kết nối này đã cắm ở văn phòng khác.',
  'arm.keyDeadTitle': 'Kết nối này cần đăng nhập lại',
  'arm.keyDeadBody':
    'Dịch vụ đã từ chối chìa của "{who}". Chuyện này xảy ra khi lượt đăng nhập bị thu hồi, bạn đổi mật khẩu, hoặc kết nối để lâu quá không dùng. Đăng nhập lại một lần là xong — mọi văn phòng đang dùng kết nối này sống lại cùng lúc.',
  'arm.keyDeadShort': 'đăng nhập đã hết hiệu lực',
  'arm.signInAgain': 'Đăng nhập lại',
  'arm.noFolderChosen': 'Chưa chọn thư mục nào.',
  'arm.checkingShort': 'Đang kiểm tra…',
  'arm.changeFolderLong': 'Đổi thư mục…',
  'arm.browseTitle': 'Chọn thư mục',
  'arm.browseDesc':
    'Đây là các thư mục trên máy đang chạy agentco — không phải máy bạn đang ngồi, nếu hai cái khác nhau.',
  'arm.pathPlaceholder': 'Hoặc dán đường dẫn rồi Enter',
  'arm.currentlyAt': 'Đang ở',
  'arm.pickADrive': 'Chọn một ổ đĩa',
  'arm.noSubfolders': 'Không có thư mục con nào đọc được ở đây.',
  'arm.useThisFolder': 'Xong — dùng thư mục này',
  'arm.probeZeroTools': 'Nối được, nhưng 0 việc',
  'arm.probeOk': 'Chạy được · {n}',
  'arm.probeSplit': '{read} việc chỉ đọc · {write} việc có ghi',
  'arm.probeNeedsLoginTitle': 'Cần đăng nhập một lần',
  'arm.probeAuthTitle': 'Dịch vụ này yêu cầu xác thực',
  'arm.probeNeedsLoginBefore':
    'Kết nối được, nhưng dịch vụ này cần bạn cho phép trên trình duyệt. Bấm',
  'arm.probeNeedsLoginAfter': 'ở trên.',
  'arm.probeNoKeyBefore': 'Máy chủ trả lời được, nhưng nó từ chối vì chưa có chìa. Đường',
  'arm.probeNoKeyBold': 'Tự cắm MCP',
  'arm.probeNoKeyAfter': 'chưa đăng nhập hộ bạn được — bạn phải tự đưa chìa vào.',
  'arm.probeMatchBefore': '⭐',
  'arm.probeMatchMid': 'đã có sẵn ở',
  'arm.probeMatchBold': 'Dịch vụ có sẵn',
  'arm.probeMatchAfter': '. Quay lại chọn nó thì chỉ cần bấm Đăng nhập, không phải tự đi lấy chìa.',
  'arm.probeKeyHintBefore':
    'Chìa phải nằm trong chính khối JSON này. README của dịch vụ ghi nó đi vào đâu — có thể là một header trong',
  'arm.probeKeyHintMid': ', có thể là một biến trong',
  'arm.probeKeyHintMid2': ', mỗi hãng một khác. Chép đúng chỗ đó, rồi',
  'arm.probeKeyHintBold': 'thay giá trị thật bằng',
  'arm.probeKeyHintAfter':
    ': chỗ đó sẽ thành một ô nhập ở ngay dưới, và chìa không bị ghi vào file cấu hình.',
  'arm.probeFailedTitle': 'Chưa kết nối được',
  'arm.connecting': 'Đang kết nối…',
  'arm.tryAgain': 'Thử lại',
  'arm.tryIt': 'Thử ngay',
  'arm.checking': 'Đang kiểm tra kết nối…',
  'arm.slowHint':
    'Bước này mất khoảng 10–25 giây: máy phải khởi động công cụ kết nối rồi hỏi xem nó làm được những gì.',
  'arm.goBack': 'Quay lại',
  'arm.next': 'Tiếp',
  'arm.noAgentsYet': 'Văn phòng này chưa có nhân viên nào. Cứ lưu — cắm xong rồi nối dây sau cũng được.',
  'arm.grantNobody':
    'Chưa chọn ai thì kết nối này nằm im — không ai dùng được, và nó không tốn token nào.',
  'arm.grantSome': '{n} người sẽ dùng được kết nối này ngay ở việc kế tiếp.',
  'arm.grantTokens': ' Mỗi người trả thêm ~{n} token mỗi lượt.',
  'arm.done': 'Xong',
  'arm.forgetTitle': 'Xoá hẳn khỏi sổ chung?',
  'arm.forgetBody1': 'sẽ biến mất khỏi công ty và',
  'arm.forgetBodyBold': 'không lấy lại được',
  'arm.forgetBody2': '. Không văn phòng nào đang dùng nó.',
  'arm.forgetKeysKept':
    'Chìa ({keys}) vẫn được giữ — cắm lại thì không phải đi lấy token lần nữa.',
  'arm.forgetNoKeys': 'Kết nối này không cần chìa nào, nên cắm lại là chọn từ danh mục.',
  'arm.dropWsTitle': 'Gỡ workspace này?',
  'arm.dropWsBefore': 'agentco sẽ quên chìa của',
  'arm.dropWsMid': 'và',
  'arm.dropWsBold': 'báo cho dịch vụ thu hồi',
  'arm.dropWsAfter': 'quyền truy cập.',
  'arm.dropWsSafe': 'Không mất gì trong workspace của bạn. Cần lại thì đăng nhập lần nữa.',
  'arm.tabHint':
    'Xong ở tab kia thì đây tự cập nhật. Nếu tab đó báo lỗi (hay bạn đã đóng nó), bấm lại nút trên — mỗi lần bấm là một lượt mới.',
  'arm.mixedCwdAfter':
    '. Form chỉ giữ được một thư mục chung, nên nó không đọc ngược được — sửa tiếp ở đây, hoặc cho các lệnh về cùng một',

  'arm.scopeTitle': 'Chọn phạm vi trên {name}',
  'arm.deviceTitle': 'Gõ mã này ở {name}',
  'arm.deviceLeft': 'còn {mm}:{ss}',
  'arm.copyCode': 'Chép mã',
  'arm.deviceStep1Before': 'Mở',
  'arm.deviceStep1After': '— ở máy này hay điện thoại đều được.',
  'arm.deviceStep2': 'Gõ mã ở trên rồi bấm cho phép.',
  'arm.deviceStep3': 'Quay lại đây — màn này tự biết, không cần F5.',
  'arm.deviceAccountBefore': '⚠ Trang đó sẽ dùng',
  'arm.deviceAccountBold': 'tài khoản đang đăng nhập trên trình duyệt của bạn',
  'arm.deviceAccountAfter': '. Nếu đó không phải tài khoản bạn muốn nối, mở nó bằng cửa sổ ẩn danh.',
  'arm.repoTitle': 'Repo agentco được phép đụng',
  'arm.repoScanning': 'Đang hỏi {name} xem app được cài vào những repo nào…',
  'arm.repoScanFailedBefore':
    'Không hỏi được danh sách repo lúc này. Vẫn cắm được — nhưng nếu nhân viên báo không tìm thấy repo, hãy quay lại bấm',
  'arm.repoScanFailedAfter': 'ở trên.',
  'arm.repoInstalledBefore': 'Đã cài trên',
  'arm.repoInstalledMid': 'repo của',
  'arm.repoNotInstalled': '— {n} repo khác thì chưa cài',
  'arm.repoPublicNoteBefore':
    'Repo công khai thì nhân viên vẫn đọc được dù chưa cài — danh sách trên là những repo có quyền',
  'arm.repoPublicNoteBold': 'đầy đủ',
  'arm.repoPublicNoteAfter': '(gồm repo riêng tư và quyền ghi).',
  'arm.repoNoneAfter':
    'chưa cài agentco vào repo nào. Nhân viên sẽ không đọc được repo riêng tư và không ghi được gì cả.',
  'arm.repoRecheck': 'Cài xong rồi — kiểm lại',
  'arm.repoAnywayBefore': 'Đã hiểu và tiếp tục —',
  'arm.repoAnywayItalic': 'repo của tổ chức không hiện ở đây được',
  'arm.ownClientSummary': 'Dùng {name} App của riêng bạn',
  'arm.ownClientOn': '· đang bật',
  'arm.ownClientNoteBefore':
    'Mặc định đăng nhập đi qua app của agentco. Muốn đứng tên chính bạn thì tạo một {name} App rồi dán',
  'arm.ownClientNoteBold': 'Client ID',
  'arm.ownClientNoteAfter': 'vào đây. Để trống = quay về app của agentco.',
  'arm.ownClientWarnBefore': 'Client ID là',
  'arm.ownClientWarnBold': 'dữ liệu công khai',
  'arm.ownClientWarnAfter': '— đừng dán client secret hay private key.',

  // ─────────────────────────────────────────────────────────── work log
  'plans.status.planning': 'đang lập kế hoạch',
  'plans.status.running': 'đang chạy',
  'plans.status.done': 'xong',
  'plans.status.failed': 'hỏng',
  'plans.status.blocked': 'bạn trả lời',
  'plans.status.paused': 'tạm nghỉ',
  'plans.status.stopped': 'đã dừng',
  'plans.loadFailed': 'Không đọc được lịch sử công việc.',
  'plans.openFailed': 'Không mở được công việc này.',
  'plans.emptyTitle': 'Chưa có công việc nào',
  'plans.emptyHint': 'Mỗi việc bạn giao sinh ra một bản ghi riêng, có kế hoạch và nhật ký của chính nó.',
  'plans.unfinished': '{n} chưa xong',
  'plans.showAll': 'Hiện tất cả',
  'plans.onlyDone': 'Chỉ việc xong',
  'plans.noneDoneBefore': 'Chưa có việc nào xong.',
  'plans.noneDoneAfter': 'còn lại đang bị bộ lọc ẩn đi —',
  'plans.showAllInline': 'hiện tất cả',
  'plans.back': 'Quay lại danh sách',
  'plans.reload': 'Tải lại',
  'plans.noEvents': 'Việc này chưa ghi được sự kiện nào.',
  'plans.report': 'Kết quả',
  'plans.collapse': 'Thu gọn',
  'plans.expand': 'Xem đầy đủ',
  'plans.tokenLabel': 'Token:',
  'plans.cacheRead': 'đọc lại',
  'plans.cacheWrite': 'ghi cache',
  'plans.turns': 'lượt',
  'plans.cacheChurnBadge': '⚠ ghi cache lặp',
  'plans.details': 'chi tiết',
  'plans.colJob': 'việc',
  'plans.churnWarn':
    '⚠ {roles} ghi cache nhiều lần trong một ca. Có thứ gì đang phá prefix giữa chừng — sửa skills, đổi model, hoặc bump version lúc đang chạy.',
  'plans.churnOkBefore': 'Task đầu của mỗi vai trò',
  'plans.churnOkBold': 'ghi cache',
  'plans.churnOkAfter':
    'lớn, các task sau nhỏ — đó là cache priming gate chạy đúng. Cả loạt đều lớn nghĩa là gate hỏng.',
  'plans.totalPrefix': 'tổng',

  // ───────────────────────────────────────────────────────────── results
  'artifacts.loadFailed': 'Không đọc được danh sách kết quả.',
  'artifacts.gone': 'Không còn "{name}" trong ngăn Kết quả — có lẽ nó đã bị xoá.',
  'artifacts.deleteFailed': 'Không xoá được.',
  'artifacts.emptyTitle': 'Chưa có kết quả nào',
  'artifacts.emptyHint':
    'Đây là nơi giữ file nhân viên làm ra qua mỗi việc được giao — xem trước, tải về, hoặc xoá đi.',
  'artifacts.deleteAll': 'Xoá tất cả',
  'artifacts.downloadOnly': 'chỉ tải về',
  'artifacts.downloadFile': 'Tải {name}',
  'artifacts.delete': 'Xoá {name}',
  'artifacts.footerBefore': 'Đây là thứ',
  'artifacts.footerBold1': 'nhân viên làm ra',
  'artifacts.footerMid':
    '. Không sửa được — muốn thay đổi thì nhắn Trợ lý làm lại. Những tài liệu muốn dùng lâu dài thì thêm vào',
  'artifacts.footerBold2': 'Tủ tài liệu',
  'artifacts.confirmDeleteTitle': 'Xoá kết quả?',
  'artifacts.confirmDeleteBody1': 'sẽ bị xoá hẳn. Đây là',
  'artifacts.onlyCopy': 'bản duy nhất',
  'artifacts.confirmDeleteBody2':
    '— không có bản sao nào khác trên máy bạn, và nhân viên phải chạy lại từ đầu nếu bạn cần nó.',
  'artifacts.confirmAllBefore': 'Toàn bộ',
  'artifacts.confirmAllMid': 'trong ngăn này bị xoá hẳn, kể cả của những việc chạy hôm nay. Đây là',
  'artifacts.confirmAllAfter': '— cần lại thì phải chạy lại và trả tiền lại.',
  'artifacts.untouchedBefore': 'Tủ tài liệu và Kho tri thức',
  'artifacts.untouchedBold': 'không',
  'artifacts.untouchedAfter': 'bị đụng tới.',
  'artifacts.legacyGroup': 'Kết quả cũ (trước khi tách theo việc)',
  'artifacts.runAt': 'Việc chạy {when}',
  'artifacts.readFailedStatus': 'Không đọc được (lỗi {status}).',
  'artifacts.readFailed': 'Không đọc được file.',
  'artifacts.nativeOnlyTitle': 'Định dạng này phải mở bằng ứng dụng gốc',
  'artifacts.nativeOnlyHint':
    'Xem trước một file Word/Excel/PowerPoint bằng cách bóc chữ ra sẽ mất bảng, mất bố cục, mất ảnh — tức là bạn duyệt một thứ khác với thứ sẽ gửi đi. Tải về rồi mở bằng ứng dụng thật.',
  'artifacts.pdfFallback': 'Trình duyệt không mở được PDF ở đây — tải về nhé.',
  'artifacts.downloadButton': 'Tải về',
  'artifacts.emptyFile': 'File rỗng.',
  'artifacts.csvCapped': 'Chỉ hiện 500 dòng đầu. Tải về để xem đủ.',

  // ─────────────────────────────────────────────────────── document cabinet
  'library.loadFailed': 'Không đọc được tủ tài liệu.',
  'library.uploadFailed': 'không tải lên được.',
  'library.deleteFailed': 'Không xoá được.',
  'library.reextractFailed': 'Chưa bóc lại được tài liệu này.',
  'library.uploading': 'Đang tải lên…',
  'library.add': 'Thêm tài liệu',
  'library.dropHint1': 'Kéo thả file vào đây. Hỗ trợ mạnh',
  'library.dropHint2': '. Có hỗ trợ',
  'library.dropHint3': 'nhưng cân nhắc bị giảm hiệu suất.',
  'library.emptyTitle': 'Tủ tài liệu còn trống',
  'library.emptyHint':
    'Thả vào đây tài liệu bạn muốn nhân viên đọc: hợp đồng, chính sách, bảng kê, CV. Nội dung được bóc ra một lần lúc thả vào và không tốn thêm chi phí.',
  'library.tokensApprox': '~{n} token',
  'library.reextract': 'Bóc lại {name}',
  'library.reextractTip': 'Bóc lại — thử đọc lại tài liệu này',
  'library.download': 'Tải {name}',
  'library.delete': 'Xoá {name}',
  'library.footerBefore': 'Đây là tài liệu',
  'library.footerBold': 'bạn đưa vào',
  'library.footerAfter': '. Nội dung được bóc ra một lần lúc thả vào.',
  'library.confirmDeleteTitle': 'Xoá tài liệu?',
  'library.confirmDeleteBody': 'sẽ bị xoá khỏi tủ. Bản gốc trên máy bạn không bị ảnh hưởng.',
  'library.clashTitle': 'Đã có tài liệu trùng tên',
  'library.clashBody':
    'Trong tủ đã có: {names}. Thay thế sẽ ghi đè bản cũ và đọc lại nội dung từ đầu.',
  'library.keepOld': 'Giữ bản cũ',
  'library.replace': 'Thay thế',
  'library.state.pending': 'đang chờ',
  'library.state.extracting': 'đang đọc…',
  'library.state.imageOnly': 'bản chụp',
  'library.state.unindexed': 'chưa lập chỉ mục',
  'library.state.failed': 'lỗi',

  // ─────────────────────────────────────────────────────── knowledge base
  'knowledge.loadFailed': 'Không đọc được kho tri thức.',
  'knowledge.emptyTitle': 'Kho tri thức còn trống',
  'knowledge.emptyHint':
    'Nhân viên tự ghi vào sổ tay riêng khi rút ra bài học; Trợ lý ghi vào kho chung sau mỗi ca. Không ai phải nhập tay — đây là thứ hệ thống tự học được.',
  'knowledge.toLibrary': 'Tài liệu của bạn thì thả vào Tủ tài liệu',
  'knowledge.search': 'Tìm trong kho…',
  'knowledge.searchLabel': 'Tìm',
  'knowledge.shared': 'chung',
  'knowledge.pinned': 'ghim',
  'knowledge.superseded': 'đã bị bản mới đè',
  'knowledge.noMatch': 'Không có ghi chú nào khớp “{q}”.',
  'knowledge.footerBefore': 'Đây là thứ hệ thống',
  'knowledge.footerBold': 'tự rút ra',
  'knowledge.footerAfter':
    ': Trợ lý ghi vào kho chung, nhân viên ghi vào sổ tay riêng (📒 trên node của họ, chỉ mình họ đọc). Bạn sửa và xoá được, nhưng không thêm mới —',
  'knowledge.toLibraryInline': 'tài liệu của bạn thì thả vào Tủ tài liệu',
  'knowledge.ownBefore': 'Sổ tay riêng của',
  'knowledge.ownAfter': '— chỉ mình người này đọc.',
  'knowledge.sharedBefore': 'Kho',
  'knowledge.sharedAfter': '— mọi nhân viên trong văn phòng đều đọc, ở mọi việc.',
  'knowledge.supersededTitle': 'Đã có bản mới thay thế.',
  'knowledge.supersededBody': 'Bản này không còn đi vào prompt của ai và sẽ được dọn ở lần dọn tới.',
  'knowledge.editNoteBefore': 'Sửa xong áp dụng ngay cho việc giao',
  'knowledge.editNoteBold': 'từ giờ trở đi',
  'knowledge.editNoteAfter':
    '; việc đang chạy giữ nguyên bản cũ. Ghi chú nằm trong bộ nhớ đệm nên mỗi lần sửa là một lần ghi lại cache.',
  'knowledge.delete': 'Xoá',
  'knowledge.confirmDelete': 'Chắc chắn xoá',

  // ───────────────────────────────────────────────── layered prompt dialog
  'promptLayer.title': 'Prompt của {who}',
  'promptLayer.editable': 'sửa được',
  'promptLayer.readOnly': 'chỉ đọc',
  'promptLayer.edit': 'Sửa {title}',
  'promptLayer.fileLabel': 'File:',
  'promptLayer.emptyPlaceholder': 'Để trống cũng được — khối này sẽ biến mất hẳn khỏi prompt.',
  'promptLayer.overLimit':
    'Vượt trần {limit} token. Khối này nằm trong prefix cache nên mỗi dòng thừa là chi phí thu suốt ca làm việc.',
  'promptLayer.loadFailed': 'Không đọc được prompt.',
  'promptLayer.assistantCoreTitle': 'Quy cách kết nối (lõi)',
  'promptLayer.assistantCoreNote': 'Cách Trợ lý nói chuyện với nhân viên và giao thức nhận kết quả.',
  'promptLayer.workerCoreTitle': 'Quy cách làm việc (lõi)',
  'promptLayer.charterTitle': 'Giới thiệu văn phòng',
  'promptLayer.charterPlaceholder':
    'Văn phòng {office} làm nội dung cho khách hàng nhỏ ở Việt Nam.\nNgười đọc là chủ shop, không phải dân kỹ thuật.\nMọi bài viết đều xưng "mình", không dùng từ Hán Việt nặng.',
  'promptLayer.charterNote': 'Văn phòng này làm gì, cho ai, cần quy tắc gì không. Có thể để trống.',
  'promptLayer.skillsTitle': 'Kỹ năng — bạn viết',
  'promptLayer.assistantSkillsPlaceholder':
    '- Xưng "mình", gọi người dùng là "bạn". Nói ngắn, không khách sáo.\n- Yêu cầu mơ hồ thì hỏi lại đúng MỘT câu quan trọng nhất.\n- Báo cáo bằng lời người thường, không nhắc tên tool hay số token.',
  'promptLayer.assistantSkillsNote': 'Tính cách, giọng điệu, thói quen của riêng Trợ lý. Có thể để trống.',
  'promptLayer.roleSkillsPlaceholder':
    'Ví dụ:\n- Luôn viết ở ngôi thứ hai, câu ngắn.\n- Mở đầu bằng kết luận, đừng dẫn dắt.\n- Không dùng emoji.',
  'promptLayer.roleSkillsNote': 'Cách làm việc của nhân viên. Để TRỐNG là bình thường',
  'promptLayer.memoryTitle': 'Ghi nhớ từ trò chuyện',
  'promptLayer.memoryNote':
    'Những gì BẠN đã chốt, Trợ lý nén lại mỗi khi dọn cuộc trò chuyện (`/clear`). Sửa hoặc xoá ở ngăn kéo Tri thức — bản mới tự đè bản cũ, bản cũ vẫn còn file.',
  'promptLayer.knowledgeTitle': 'Kinh nghiệm nạp sẵn',
  'promptLayer.knowledgeNote': 'Tự động hình thành qua quá trình làm việc. Xem thêm tại Kho tri thức',
  'promptLayer.libraryTitle': 'Danh sách tài liệu',
  'promptLayer.libraryNote': 'Tên và hình dạng các tài liệu trong tủ tài liệu.',
  'promptLayer.artifactsTitle': 'Danh sách file kết quả',
  'promptLayer.artifactsNote': 'Tên các file kết quả giúp Trợ lý làm tiếp được trên kết quả cũ.',
};

/**
 * Vietnamese has no grammatical plural, so both branches are the same sentence.
 * They are still spelled out rather than collapsed to one field: the shape is
 * shared with every other locale, and a language-specific shape here would mean
 * `plural()` has to ask which language it is looking at before it can read.
 */
export const viPlural: PluralCatalog = {
  'inspector.stepCount': { one: '{n} bước', other: '{n} bước' },
  'inspector.toolCount': { one: '{n} việc', other: '{n} việc' },
  'inspector.peopleCount': { one: '{n} người', other: '{n} người' },
  'plans.jobCount': { one: '{n} việc', other: '{n} việc' },
  'plans.turnCount': { one: '{n} lượt', other: '{n} lượt' },
  'plans.eventPlanned': { one: 'lập kế hoạch {n} bước', other: 'lập kế hoạch {n} bước' },
  'artifacts.count': { one: '{n} kết quả', other: '{n} kết quả' },
  'artifacts.removed': { one: 'Đã xoá {n} kết quả.', other: 'Đã xoá {n} kết quả.' },
  'artifacts.removedWithLeft': {
    one: 'Đã xoá {n} kết quả — còn {total} file không xoá được.',
    other: 'Đã xoá {n} kết quả — còn {total} file không xoá được.',
  },
  'artifacts.countCapped': {
    one: '{n} kết quả · đang hiện {shown} mới nhất',
    other: '{n} kết quả · đang hiện {shown} mới nhất',
  },
  'artifacts.countBytes': { one: '{n} kết quả · {size}', other: '{n} kết quả · {size}' },
  'artifacts.confirmAllTitle': { one: 'Xoá cả {n} kết quả?', other: 'Xoá cả {n} kết quả?' },
  'artifacts.fileCount': { one: '{n} file', other: '{n} file' },
  'knowledge.noteCount': { one: '{n} ghi chú', other: '{n} ghi chú' },
  'overview.agentCount': { one: '{n} người', other: '{n} người' },
  'overview.onDutyCount': { one: '{n} người trực', other: '{n} người trực' },
  'overview.employeeCount': { one: '{n} nhân viên', other: '{n} nhân viên' },
  'overview.lessonNotes': { one: '{n} ghi chú kinh nghiệm', other: '{n} ghi chú kinh nghiệm' },
  'overview.lessonNotesKept': {
    one: '{n} ghi chú kinh nghiệm còn giữ',
    other: '{n} ghi chú kinh nghiệm còn giữ',
  },
  'header.taskCount': { one: '{n} việc', other: '{n} việc' },
  'header.turnCount': { one: '{n} lượt', other: '{n} lượt' },
  'node.libraryCount': { one: '{n} tài liệu', other: '{n} tài liệu' },
  'office.armCount': { one: '{n} kết nối', other: '{n} kết nối' },
  'cmd.readingMore': { one: 'Đang đọc {names} và {n} file nữa…', other: 'Đang đọc {names} và {n} file nữa…' },
  'lib.shapeLines': { one: '{n} dòng', other: '{n} dòng' },
  'lib.shapeCsv': { one: 'csv, {n} dòng', other: 'csv, {n} dòng' },
  'lib.shapeDocxHeadings': { one: 'docx, {n} mục', other: 'docx, {n} mục' },
  'lib.shapeDocxParas': { one: 'docx, {n} đoạn', other: 'docx, {n} đoạn' },
  'lib.shapeSheets': { one: '{n} sheet', other: '{n} sheet' },
  'lib.shapeSlides': { one: '{n} slide', other: '{n} slide' },
  'lib.shapePdfPages': { one: 'pdf, {n} trang', other: 'pdf, {n} trang' },
  'plan.fileCount': { one: '{n} file', other: '{n} file' },
  'off.sweptReplaced': { one: '{n} bản ghi nhớ cũ đã được thay', other: '{n} bản ghi nhớ cũ đã được thay' },
  'off.sweptAged': { one: '{n} ghi chú lâu không dùng', other: '{n} ghi chú lâu không dùng' },
  'off.andMoreFiles': { one: '…và {n} file nữa', other: '…và {n} file nữa' },
  'off.splitInto': { one: 'Mình chia thành {n} việc:', other: 'Mình chia thành {n} việc:' },
  'wk.stoppedPartial': {
    one: 'Đã dừng giữa chừng. Có {n} file đã ghi dở, xem lại trước khi dùng.',
    other: 'Đã dừng giữa chừng. Có {n} file đã ghi dở, xem lại trước khi dùng.',
  },
  'activity.workers': { one: '{n} nhân viên đang làm việc', other: '{n} nhân viên đang làm việc' },
  'activity.queued': { one: '{n} tin chờ', other: '{n} tin chờ' },
  'activity.jobs': { one: '{n} việc xếp hàng', other: '{n} việc xếp hàng' },
  'library.extracting': {
    one: 'Đang đọc nội dung {n} tài liệu… Nhân viên tìm được bằng từ khoá ngay khi xong.',
    other: 'Đang đọc nội dung {n} tài liệu… Nhân viên tìm được bằng từ khoá ngay khi xong.',
  },
  'knowledge.tokens': { one: '{n} token', other: '{n} token' },
  'knowledge.hits': { one: 'dùng {n} lần', other: 'dùng {n} lần' },
  'promptLayer.tokens': { one: '{n} token', other: '{n} token' },
  'promptLayer.tokensOfLimit': { one: '{n} / {limit} token', other: '{n} / {limit} token' },
  'promptLayer.affected': {
    one: 'Lưu sẽ làm {n} nhân viên ghi lại bộ nhớ đệm một lần.',
    other: 'Lưu sẽ làm {n} nhân viên ghi lại bộ nhớ đệm một lần.',
  },
};
