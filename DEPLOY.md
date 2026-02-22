# GitHub + Vercel 배포 방법

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
