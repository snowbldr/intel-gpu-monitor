FROM ubuntu:24.04

# Install tools
RUN apt update && apt install -y wget curl ca-certificates gnupg unzip

# Install Docker
RUN install -m 0755 -d /etc/apt/keyrings && \
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc && \
    chmod a+r /etc/apt/keyrings/docker.asc && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list && \
    apt update && \
    apt install -y docker-ce-cli

# Install xpu-smi and intel-gpu-tools
RUN wget -qO - https://repositories.intel.com/gpu/intel-graphics.key | \
      gpg --yes --dearmor --output /usr/share/keyrings/intel-graphics.gpg && \
    echo "deb [arch=amd64,i386 signed-by=/usr/share/keyrings/intel-graphics.gpg] https://repositories.intel.com/gpu/ubuntu jammy client" | \
      tee /etc/apt/sources.list.d/intel-gpu-jammy.list && \
    apt update && \
    apt install -y xpu-smi intel-gpu-tools

# Install node \
RUN mkdir /nvm && PROFILE=/dev/null bash -c 'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | NVM_DIR="/nvm" bash' && \
    . /nvm/nvm.sh && \
    nvm install 22 && \
    ln -s $(which node) /usr/bin/node && \
    ln -s $(which npm) /usr/bin/npm && \
    node -v && npm -v

WORKDIR /app

# Install deps
COPY package.json package-lock.json /app/
RUN npm i

# Install app
COPY index.js compose.yaml /app/

# Cleanup
RUN apt autoremove && apt autoclean && apt clean

ENTRYPOINT ["node", "/app/index.js"]