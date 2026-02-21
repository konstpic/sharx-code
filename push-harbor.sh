#!/bin/bash

# ========================================================
# Скрипт для загрузки образов в Harbor
# ========================================================

# Настройки Harbor (измените под ваш Harbor)
HARBOR_HOST="registry.konstpic.ru"  # Замените на адрес вашего Harbor
HARBOR_PROJECT="3x-ui"              # Название проекта в Harbor
HARBOR_USER="admin"                 # Пользователь Harbor
HARBOR_PASSWORD="Labirinth1@3"                   # Пароль (можно передать через переменную окружения)

# Версии образов
POSTGRES_VERSION="16-alpine"
XUI_VERSION="3.0.0b"
NODE_VERSION="3.0.0b"

# Проверка аргументов командной строки
REBUILD=false
if [[ "$1" == "--no-cache" ]] || [[ "$1" == "--rebuild" ]]; then
    REBUILD=true
    echo "🔄 Режим принудительной пересборки (без кеша)"
fi

# Функция для логина в Harbor
login_to_harbor() {
    echo "🔐 Логин в Harbor..."
    if [ -z "$HARBOR_PASSWORD" ]; then
        echo "Введите пароль для Harbor:"
        read -s HARBOR_PASSWORD
    fi
    echo "$HARBOR_PASSWORD" | docker login "$HARBOR_HOST" -u "$HARBOR_USER" --password-stdin
    if [ $? -ne 0 ]; then
        echo "❌ Ошибка логина в Harbor"
        exit 1
    fi
    echo "✅ Успешно залогинились в Harbor"
}

# Функция для тегирования и пуша образа
push_image() {
    local source_image=$1
    local target_image=$2
    local version=$3
    
    echo ""
    echo "📦 Обрабатываем образ: $source_image"
    
    # Тегируем образ
    echo "🏷️  Тегируем образ..."
    docker tag "$source_image" "$HARBOR_HOST/$HARBOR_PROJECT/$target_image:$version"
    
    # Пушим образ
    echo "⬆️  Пушим образ в Harbor..."
    docker push "$HARBOR_HOST/$HARBOR_PROJECT/$target_image:$version"
    
    if [ $? -eq 0 ]; then
        echo "✅ Образ $target_image:$version успешно загружен"
    else
        echo "❌ Ошибка при загрузке образа $target_image:$version"
        exit 1
    fi
}

# ========================================================
# Основной процесс
# ========================================================

echo "🚀 Начинаем загрузку образов в Harbor"
echo "Harbor: $HARBOR_HOST"
echo "Проект: $HARBOR_PROJECT"
echo ""

# Логин в Harbor
login_to_harbor

# 1. PostgreSQL образ
echo ""
echo "=========================================="
echo "1️⃣  PostgreSQL"
echo "=========================================="
# Сначала нужно скачать образ postgres, если его нет
if ! docker images | grep -q "postgres.*$POSTGRES_VERSION"; then
    echo "📥 Скачиваем образ postgres:$POSTGRES_VERSION..."
    docker pull "postgres:$POSTGRES_VERSION"
fi
push_image "postgres:$POSTGRES_VERSION" "postgres" "$POSTGRES_VERSION"

# 2. 3x-ui образ
echo ""
echo "=========================================="
echo "2️⃣  3x-ui"
echo "=========================================="
# Находим имя образа 3xui
XUI_IMAGE=$(docker images --format "{{.Repository}}:{{.Tag}}" | grep -E "(3x-ui|3xui)" | head -1)
if [ -z "$XUI_IMAGE" ] || [ "$REBUILD" = true ]; then
    if [ "$REBUILD" = true ]; then
        echo "🔨 Пересобираем образ 3x-ui (без кеша)..."
        docker-compose build --no-cache 3xui
    else
        echo "🔨 Собираем образ 3x-ui..."
        docker-compose build 3xui
    fi
    # Проверяем снова после сборки
    XUI_IMAGE=$(docker images --format "{{.Repository}}:{{.Tag}}" | grep -E "(3x-ui|3xui)" | head -1)
    if [ -z "$XUI_IMAGE" ]; then
        echo "❌ Образ 3x-ui не найден. Соберите его вручную:"
        echo "   docker-compose build 3xui"
        echo "   или"
        echo "   docker build -t 3x-ui:latest ."
        exit 1
    fi
fi
push_image "$XUI_IMAGE" "3xui" "$XUI_VERSION"

# 3. Node образ
echo ""
echo "=========================================="
echo "3️⃣  Node"
echo "=========================================="
# Находим имя образа node
NODE_IMAGE=$(docker images --format "{{.Repository}}:{{.Tag}}" | grep -E "(node|3x-ui-node)" | head -1)
if [ -z "$NODE_IMAGE" ] || [ "$REBUILD" = true ]; then
    if [ "$REBUILD" = true ]; then
        echo "🔨 Пересобираем образ node (без кеша)..."
        # Контекст должен быть корневой директорией проекта (где go.mod и go.sum)
        # Dockerfile находится в node/Dockerfile
        docker build --no-cache -f node/Dockerfile -t 3x-ui-node:latest .
    else
        echo "🔨 Собираем образ node..."
        # Контекст должен быть корневой директорией проекта (где go.mod и go.sum)
        # Dockerfile находится в node/Dockerfile
        docker build -f node/Dockerfile -t 3x-ui-node:latest .
    fi
    # Проверяем снова после сборки
    NODE_IMAGE=$(docker images --format "{{.Repository}}:{{.Tag}}" | grep -E "(node|3x-ui-node)" | head -1)
    if [ -z "$NODE_IMAGE" ]; then
        echo "❌ Образ node не найден после сборки. Соберите его вручную:"
        echo "   docker build -f node/Dockerfile -t 3x-ui-node:latest ."
        exit 1
    fi
fi
push_image "$NODE_IMAGE" "node" "$NODE_VERSION"

echo ""
echo "=========================================="
echo "✅ Все образы успешно загружены в Harbor!"
echo "=========================================="
echo ""
echo "Образы доступны по адресам:"
echo "  - $HARBOR_HOST/$HARBOR_PROJECT/postgres:$POSTGRES_VERSION"
echo "  - $HARBOR_HOST/$HARBOR_PROJECT/3xui:$XUI_VERSION"
echo "  - $HARBOR_HOST/$HARBOR_PROJECT/node:$NODE_VERSION"
echo ""
echo "Для использования в docker-compose.yml обновите image:"
echo "  postgres:"
echo "    image: $HARBOR_HOST/$HARBOR_PROJECT/postgres:$POSTGRES_VERSION"
echo ""
echo "  3xui:"
echo "    image: $HARBOR_HOST/$HARBOR_PROJECT/3xui:$XUI_VERSION"
echo ""
echo "  node:"
echo "    image: $HARBOR_HOST/$HARBOR_PROJECT/node:$NODE_VERSION"
echo ""
echo "💡 Для принудительной пересборки используйте:"
echo "   ./push-to-harbor.sh --no-cache"
echo "   или"
echo "   ./push-to-harbor.sh --rebuild"
