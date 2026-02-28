# GitHub + Vercel 배포 방법

**최종 배포/자료 업데이트:** 어제 회사에서 수정 후 배포 완료.

## 1. GitHub 저장소 만들기

1. [GitHub](https://github.com) 로그인 후 **New repository** 클릭
2. 저장소 이름 예: `seongwon-flower` (원하는 이름 사용)
3. **Public** 선택, README 추가 안 해도 됨 → **Create repository**

## 2. 로컬에서 Git 초기화 및 푸시

**PowerShell 또는 명령 프롬프트**를 열고 프로젝트 폴더로 이동한 뒤 아래 순서대로 실행하세요.

```powershell
# 프로젝트 폴더로 이동 (경로에 한글이 있으면 그대로 입력)
cd "c:\성원플라워"

# Git이 없으면 초기화
git init

# 모든 파일 추가 (.env, node_modules 등은 .gitignore에 의해 제외됨)
git add .

# 첫 커밋
git commit -m "Initial commit: 성원플라워 대시보드"

# GitHub 저장소 연결 (아래 YOUR_USERNAME, YOUR_REPO를 본인 것으로 변경)
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git

# 기본 브랜치 이름 설정 (필요 시)
git branch -M main

# GitHub에 푸시
git push -u origin main
```

- `YOUR_USERNAME`: GitHub 사용자명  
- `YOUR_REPO`: 방금 만든 저장소 이름  

이미 Git이 있고 `origin`이 있으면 `git remote add` 대신 `git remote set-url origin https://...` 로 주소만 바꿀 수 있습니다.

## 3. Vercel에 배포

1. [Vercel](https://vercel.com) 로그인 (GitHub 계정으로 로그인 권장)
2. **Add New** → **Project**
3. **Import Git Repository**에서 방금 푸시한 GitHub 저장소 선택
4. **Configure Project** 화면에서:
   - **Root Directory**: `dashboard` 로 설정 (반드시 지정)
   - **Framework Preset**: Vite (자동 감지될 수 있음)
   - **Build Command**: `npm run build` (기본값)
   - **Output Directory**: `dist` (기본값)
5. **Environment Variables**에 Supabase 키 추가:
   - `VITE_SUPABASE_URL`: Supabase 프로젝트 URL
   - `VITE_SUPABASE_ANON_KEY`: Supabase anon public key
6. **Deploy** 클릭

이후에는 `main` 브랜치에 푸시할 때마다 Vercel이 자동으로 다시 배포합니다.

## 4. 환경 변수 (.env) 참고

배포 시 사용하는 값은 **dashboard** 폴더의 `.env`와 동일하게 맞추면 됩니다.  
로컬 `.env`는 Git에 올라가지 않으므로, Vercel 대시보드에서만 위 두 변수를 설정하면 됩니다.

---

## 5. 배포 후 에러 해결

### "Supabase 설정이 없습니다" 또는 화면이 비어 있음
- **Vercel** → 해당 프로젝트 → **Settings** → **Environment Variables**
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` 가 **모두** 설정되어 있는지 확인
- 값 수정 후 **Redeploy** (Deployments → ⋮ → Redeploy)

### "client_contacts 테이블이 없습니다" / relation does not exist
- Vercel에서 쓰는 **Supabase 프로젝트**와 로컬에서 쓰는 프로젝트가 같은지 확인
- **Supabase 대시보드** → **SQL Editor**에서 아래 스크립트들을 **배포에 사용하는 프로젝트**에 순서대로 실행하세요.
  - `dashboard/supabase-client-contacts.sql` (거래처 담당자)
  - 그 외 필요한 테이블: `orders`, `store_client_map`, `provider_balances`, `client_statement_format` 등 (루트의 `supabase-schema.sql` 또는 각 `dashboard/supabase-*.sql` 참고)

### 주문 목록이 안 뜨거나 네트워크 에러
- Supabase **Settings** → **API** 에서 **Project URL**과 **anon public** 키가 Vercel 환경 변수와 동일한지 확인
- Supabase **Authentication** → **URL Configuration**에서 **Site URL**에 Vercel 배포 URL 추가 (필요 시)
