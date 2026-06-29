# ご当地モンスターズ

## プロジェクト概要
位置情報ベースのモバイルWebゲーム。現地に行って卵を拾い、モンスターを育てるゲーム。

## スタック
- フロントエンド: index.html（単一ファイル、バニラJS）
- バックエンド: api/generate.js, api/egg.js（Vercel Serverless Functions）
- デプロイ: Vercel（GitHub連携で自動デプロイ）
- AI画像生成: OpenAI API (gpt-image-1)
- モンスター生成: Anthropic API (claude-sonnet-4-6)
- キャッシュ: Upstash Redis
- 画像保存: Vercel Blob
- URL: rho-eight-91.vercel.app

## 現在のバージョン
v1.0完成済み。GitHubにv1.0タグあり。

## 完成済み機能
- 位置情報取得（東京23区・大阪24区・横浜18区の区単位判定）
- 卵拾い（18時間クールダウン）
- 孵化・進化（子供→大人の2段階、テスト用20秒/1分）
- AI画像生成（gpt-image-1）
- 牧場管理（localStorage）
- 制覇マップ（47都道府県）
- トレーナーレベル・経験値バー
- 性格システム（50種）
- 技システム（大人のみ2つ、地域ネーミング、タイプ9種）
- 大人/子供タブ切替
- アバター選択（15種）
- レベルアップ演出
- PWA対応
- 特産品システム（47都道府県×5種、18時間ごと取得）
- 愛情ポイント（上限20、4時間クールダウン）
- ステータス振り分け（愛情ポイント=振り分けポイント、HP+2/ATK+1/DEF+1/SPD+1）
- 特産品図鑑

## データ管理
- localStorage: farmData, tokusanhinData, userId, trainerName, trainerAvatar
- Redis: モンスターキャッシュ（monster:child:都市名, monster:adult:都市名）、卵データ（egg:userId:都市名）

## 未実装
- バトルシステム
- 本番用タイマー（孵化8時間・進化3日、現在はテスト用20秒/1分）

## 開発ルール
- index.htmlは単一ファイルで管理
- コード変更後は必ずgit add && git commit && git pushまでやること
- 日本語で会話OK
