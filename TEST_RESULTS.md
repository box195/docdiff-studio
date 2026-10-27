# 검증 결과 — 2026-10-27

- PASS: `npm test` — 28 tests, 28 pass, 0 fail
- PASS: 100행 문서의 50번째 위치에 한 행 삽입 → 삽입 1건, 기존 아래 행 변경 0건
- PASS: 여러 행 삽입, 행 삭제/이동, 빈 행 삽입, 중복 행/중복 ID 검토, 한 셀 변경
- PASS: 값이 같은 서식 변경, 삽입 후 이동한 셀 서식 비교, 테두리 색/맞춤 서식
- PASS: 같은 시트 수식의 자동 참조 이동과 실제 수식 변경 구분
- PASS: 실제 ZIP/XML XLSX/HWPX 파싱, PDF 텍스트 추출, 실제 파일 파싱 후 교차 형식 비교
- PASS: XLSX 화면 모드 행 정렬, 페이지/영역 범위, 공백 옵션
- PASS: 5,000행 단일 삽입 비교 약 0.2초 (합성 자료, 이 PC의 Node 환경)
- PASS: JS 구문 검사와 `git diff --check`
- PASS: 인증정보 패턴 검사 — 발견 없음; 사용자 개인 문서 포함 없음
- NOT_RUN: 수정본의 실제 브라우저 UI/렌더링/Web Worker 실행 — 일반 브라우저 제어 도구가 URL 판독 실패로 중단되어 재검증하지 못함
- LIMIT: Node PDF 테스트에서 file URL 글꼴 로딩 경고 발생; 텍스트 추출은 통과했으며 브라우저 렌더링 통과를 의미하지 않음

원본 소스: Sites 커밋 `69a198c3e0cc9c4d3fece1de57936554627c6f5b`에서 복구
기존 Sites 배포 및 접근 정책 유지, GitHub 업로드와 자동 배포 연결 없음
구형 HWP/OCR/HWPX 스타일은 미지원이며 앱과 README에 안내
