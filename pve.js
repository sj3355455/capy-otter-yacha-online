// ==========================================
// PVE AI Logic for Capy-Otter-Yacha
// ==========================================

Player.prototype.updateAIInputs = function(opponent) {
    if (!opponent) return;

    if (this.aiFrameCount === undefined) {
        this.aiFrameCount = 0;
        this.aiPlannedAttackDelay = 0;
        this.aiPlannedSpecialDelay = 0;
    }
    if (this.aiPlannedJumpDelay === undefined) this.aiPlannedJumpDelay = 0;
    if (this.aiPlannedDownDelay === undefined) this.aiPlannedDownDelay = 0;
    this.aiFrameCount++;

    let decisionInterval = 15;
    let mistakeProbability = 0;
    let distanceErrorMargin = 0;
    let timingErrorFrames = 0; // 스킬 시전 타이밍 오차 (프레임)

    if (aiDifficulty === 'easy') {
        decisionInterval = 60;
        mistakeProbability = 0.3;
        distanceErrorMargin = 300;
        timingErrorFrames = 45; // 최대 0.75초 지연
    } else if (aiDifficulty === 'normal') {
        decisionInterval = 30;
        mistakeProbability = 0.1;
        distanceErrorMargin = 120;
        timingErrorFrames = 20; // 최대 0.33초 지연
    } else if (aiDifficulty === 'hard') {
        decisionInterval = 12;
        mistakeProbability = 0;
        distanceErrorMargin = 0;
        timingErrorFrames = 0; // 지연 없음
    }

    // Process delayed skill and evasion/defense executions (타이밍 오차 적용)
    if (this.aiPlannedAttackDelay > 0) {
        this.aiPlannedAttackDelay--;
        if (this.aiPlannedAttackDelay === 0) {
            this.inputs.attack = true;
        }
    }
    if (this.aiPlannedSpecialDelay > 0) {
        this.aiPlannedSpecialDelay--;
        if (this.aiPlannedSpecialDelay === 0) {
            this.inputs.special = true;
        }
    }
    if (this.aiPlannedJumpDelay > 0) {
        this.aiPlannedJumpDelay--;
        if (this.aiPlannedJumpDelay === 0) {
            this.inputs.jump = true;
        }
    }
    if (this.aiPlannedDownDelay > 0) {
        this.aiPlannedDownDelay--;
        if (this.aiPlannedDownDelay === 0) {
            this.inputs.down = true;
        }
    }

    // Only update AI movement intentions at specified intervals
    if (this.aiFrameCount % decisionInterval !== 0) {
        return;
    }

    // Reset inputs at the start of a new decision cycle
    this.inputs.attack = false;
    this.inputs.special = false;
    this.inputs.jump = false;
    this.inputs.down = false;

    // Random mistake for lower difficulties
    if (Math.random() < mistakeProbability) {
        this.inputs.moveLeft = false;
        this.inputs.moveRight = false;
        return; // Do nothing for this decision cycle
    }

    // ---------------------------------------------------------
    // ---------------------------------------------------------
    // long_attack 감지 및 방어/회피 (점프, 하향점프, 스킬 블락) - 쉬움 모드 제외
    // ---------------------------------------------------------
    let incomingLongAttack = false;
    let attackType = null;

    if (aiDifficulty !== 'easy') {
        // 1. 카피바라 돌진 감지
        if (opponent.characterType === 'capybara' && opponent.specialActiveFrames > 0) {
            // AI 쪽으로 향하고 있는지 확인
            if ((opponent.faceDir === 1 && this.x > opponent.x) || (opponent.faceDir === -1 && this.x < opponent.x)) {
                // 어려움: 정확한 히트박스(75), 보통: 넉넉한 히트박스(100)
                let dashYThreshold = (aiDifficulty === 'hard') ? 75 : 100;
                if (Math.abs(opponent.x - this.x) < 400 && Math.abs(opponent.y - this.y) <= dashYThreshold) {
                    incomingLongAttack = true;
                    attackType = 'capy_dash';
                }
            }
        }

        // 2. 원거리 투사체 감지 (부엉이 깃털, 수달 파도)
        if (!incomingLongAttack) {
            for (let i = 0; i < projectiles.length; i++) {
                let proj = projectiles[i];
                if (proj.ownerId === opponent.id && proj.active) {
                    let isLongAttack = false;
                    if (proj.ownerCharacterType === 'owl' && !proj.isSpecial) {
                        isLongAttack = true;
                        attackType = 'owl_feather';
                    } else if (proj.ownerCharacterType === 'otter' && proj.isSpecial) {
                        isLongAttack = true;
                        attackType = 'otter_wave';
                    }

                    if (isLongAttack) {
                        // 투사체가 AI 쪽으로 날아오는지 확인
                        if ((proj.vx > 0 && this.x > proj.x) || (proj.vx < 0 && this.x < proj.x)) {
                            // AI와 Y축이 겹치는지(맞는 범위에 있는지), 거리가 적당한지 확인
                            let hitThreshold = 120; // 보통 난이도: 넉넉하게 피함
                            if (aiDifficulty === 'hard') {
                                // 어려움 난이도: 투사체와 캐릭터의 실제 히트박스 기준으로만 피함
                                let aiHitboxRadiusY = this.height / 2;
                                hitThreshold = proj.hitboxRadius + aiHitboxRadiusY;
                            }
                            if (Math.abs(proj.y - (this.y + this.height / 2)) <= hitThreshold && Math.abs(proj.x - this.x) < 450) {
                                incomingLongAttack = true;
                                break;
                            }
                        }
                    }
                }
            }
        }

        // 위협 감지 시 반응 선택 로직
        if (incomingLongAttack) {
            let canBlock = false;
            // 상성에 맞는 방어 스킬이 사용 가능한지 확인
            if (this.specialCooldown === 0) {
                if (this.characterType === 'owl' && (attackType === 'capy_dash' || attackType === 'otter_wave')) {
                    canBlock = true; // 부엉이의 돌풍은 카피바라 돌진과 수달 파도를 막음
                } else if (this.characterType === 'otter' && attackType === 'capy_dash') {
                    canBlock = true; // 수달의 파도발차기는 카피바라 돌진을 막음
                }
            }

            let choices = ['jump'];
            if (this.isGrounded && this.y < 300) {
                choices.push('down');
            }
            if (canBlock) {
                // 방어 스킬을 사용할 수 있으면 방어할 확률을 높게 설정
                choices.push('block');
                choices.push('block');
                choices.push('block');
            }

            let choice = choices[Math.floor(Math.random() * choices.length)];

            if (choice === 'jump') {
                this.inputs.jump = true;
                // 피하면서 뒤로 빠지거나 가만히 있기
                this.inputs.moveLeft = this.x > opponent.x;
                this.inputs.moveRight = this.x < opponent.x;
            } else if (choice === 'down') {
                this.inputs.down = true;
                this.inputs.moveLeft = this.x > opponent.x;
                this.inputs.moveRight = this.x < opponent.x;
            } else if (choice === 'block') {
                this.inputs.special = true;
                // 스킬을 상대방 방향으로 시전
                this.faceDir = (opponent.x < this.x) ? -1 : 1;
            }
            
            return; // 회피/방어 행동을 결정했으므로 현재 사이클의 공격/추적 등 판단 종료
        }
    }

    const dx = opponent.x - this.x;
    const distX = Math.abs(dx);
    const dy = opponent.y - this.y;
    const distY = Math.abs(dy);
    const attackRange = 80;

    // Apply error margin to create "perceived" distance for attack/skill decisions
    // This makes lower difficulty AIs swing at nothing by incorrectly judging they are close enough
    let perceivedDistX = Math.max(0, distX - (Math.random() * distanceErrorMargin));
    let perceivedDistY = Math.max(0, distY - (Math.random() * distanceErrorMargin));

    // Character specific strategies
    if (this.characterType === 'capybara') {
        // Capybara: Close gap, use special when in sure-hit distance
        if (perceivedDistX > 40) {
            this.inputs.moveLeft = dx < 0;
            this.inputs.moveRight = dx > 0;
        } else {
            this.inputs.moveLeft = false;
            this.inputs.moveRight = false;
        }
        if (perceivedDistX < attackRange && perceivedDistY < 50) {
            this.inputs.attack = true;
        }
        // Use special when in proper range (not just to gap close, but to hit)
        if (this.specialCooldown === 0 && perceivedDistX > 30 && perceivedDistX < 140 && perceivedDistY < 30) {
            this.inputs.special = true;
        }
    } 
    else if (this.characterType === 'otter') {
        // Otter: Attack when close, but use special freely from distance
        if (perceivedDistX > attackRange - 20) {
            this.inputs.moveLeft = dx < 0;
            this.inputs.moveRight = dx > 0;
        } else {
            this.inputs.moveLeft = false;
            this.inputs.moveRight = false;
        }
        if (perceivedDistX < attackRange && perceivedDistY < 50) {
            this.inputs.attack = true;
        }
        // Use special even from a distance to pressure the opponent
        if (this.specialCooldown === 0 && perceivedDistX < 250 && perceivedDistY < 40) {
            this.inputs.special = true;
        }
    }
    else if (this.characterType === 'owl') {
        // Owl: Flee to the edge of the map, then attack from there.
        if (this.owlFleeing === undefined) this.owlFleeing = false;
        
        // Trigger flee if opponent gets too close (200px)
        if (perceivedDistX < 200) {
            this.owlFleeing = true;
        }
        
        // Stop fleeing if we reached the corners, BUT ONLY if opponent is not right next to us!
        // If opponent is very close (e.g., < 150) while in the corner, keep fleeing to trigger jump-over.
        if ((this.x < 80 || this.x > 920) && perceivedDistX > 150) {
            this.owlFleeing = false;
        }

        if (this.owlFleeing) {
            // Run away
            this.inputs.moveLeft = dx > 0; // Opponent is right, move left
            this.inputs.moveRight = dx < 0; // Opponent is left, move right
            
            // If backed into a corner but opponent is still close (panic mode), jump over
            if ((this.x < 50 && dx > 0) || (this.x > 970 && dx < 0)) {
                this.inputs.jump = true;
                this.inputs.moveLeft = dx < 0; // Move towards opponent to jump over
                this.inputs.moveRight = dx > 0;
                if (this.specialCooldown === 0) {
                    this.inputs.special = true;
                }
            }
        } else {
            // Reached safety corner: Maintain position
            this.inputs.moveLeft = false;
            this.inputs.moveRight = false;
        }

        // Use special if opponent gets too close to push them away
        if (this.specialCooldown === 0 && perceivedDistX < 180 && perceivedDistY < 60) {
            this.inputs.special = true;
        } else if (!this.owlFleeing) { 
            // Attack from our destination (grounded or air)
            this.inputs.attack = true;
            // Match Y-axis: If opponent jumps to avoid feathers, we jump too!
            if (this.isGrounded && dy < -40) {
                this.inputs.jump = true;
            }
        }

        // Jump frequently while fleeing to stay in the air and glide
        if (this.isGrounded && this.owlFleeing && Math.random() < 0.4) {
            this.inputs.jump = true;
        }
        
        // Fast fall: Once we reach our destination (!owlFleeing), drop like a rock to attack
        this.inputs.down = false;
        if (!this.isGrounded && this.vy >= 0 && !this.owlFleeing) {
            this.inputs.down = true;
        }
    }
    else if (this.characterType === 'quokka') {
        // Quokka: Dash in quickly, normal attack barrage
        if (perceivedDistX > 30) {
            this.inputs.moveLeft = dx < 0;
            this.inputs.moveRight = dx > 0;
        } else {
            this.inputs.moveLeft = false;
            this.inputs.moveRight = false;
        }
        if (perceivedDistX < attackRange && perceivedDistY < 50) {
            this.inputs.attack = true;
        }
        // Dash special
        if (this.specialCooldown === 0 && perceivedDistX > 50 && perceivedDistX < 250 && perceivedDistY < 50) {
            this.inputs.special = true;
        }
    }

    // ---------------------------------------------------------
    // Human-like Attack Commitment (Turnaround Time)
    // ---------------------------------------------------------
    // If the AI decides to attack, it explicitly commits to pressing the 
    // movement key towards the opponent. Because this decision is locked for
    // 'decisionInterval' frames (e.g. 0.2s), it simulates a human's minimum key press time.
    if (this.inputs.attack || this.inputs.special) {
        if (this.characterType === 'owl') {
            // 부엉이는 제자리 공격(포탑 모드)이므로, 방향만 상대쪽으로 맞춰주고 이동 키는 떼도록 강제합니다.
            // 이렇게 하면 어떤 상황에서 점프하더라도 공중에서 앞으로 끌려가지 않습니다.
            this.faceDir = dx < 0 ? -1 : 1;
            this.inputs.moveLeft = false;
            this.inputs.moveRight = false;
        } else {
            this.inputs.moveLeft = dx < 0;
            this.inputs.moveRight = dx > 0;
        }
    }

    // ---------------------------------------------------------
    // General Navigation Logic (Pathfinding for vertical platforms)
    // ---------------------------------------------------------
    let isNavigatingToPlatform = false;

    if (this.characterType !== 'owl' && dy < -80 && this.isGrounded) {
        let platformsAbove = [];
        for (let i = 0; i < platforms.length; i++) {
            const plat = platforms[i];
            if (!plat.isGround && plat.y < this.y - 20) {
                platformsAbove.push(plat);
            }
        }

        if (platformsAbove.length > 0) {
            // Find the lowest Y layer above the AI (which corresponds to the maximum Y value)
            let nextLayerY = -Infinity;
            for (let i = 0; i < platformsAbove.length; i++) {
                if (platformsAbove[i].y > nextLayerY) {
                    nextLayerY = platformsAbove[i].y;
                }
            }

            // Filter platforms to only those in the immediate next layer
            let nextLayerPlatforms = [];
            for (let i = 0; i < platformsAbove.length; i++) {
                if (Math.abs(platformsAbove[i].y - nextLayerY) < 20) {
                    nextLayerPlatforms.push(platformsAbove[i]);
                }
            }

            let platformDirectlyAbove = false;
            const centerX = this.x + this.width / 2;
            
            for (let i = 0; i < nextLayerPlatforms.length; i++) {
                const plat = nextLayerPlatforms[i];
                // Check if AI is comfortably under the platform to avoid hitting the edge
                if (centerX >= plat.x + 10 && centerX <= plat.x + plat.width - 10) {
                    platformDirectlyAbove = true;
                    break;
                }
            }

            isNavigatingToPlatform = true;

            if (platformDirectlyAbove) {
                // We are safely under a platform in the next layer, jump straight up!
                this.inputs.moveLeft = false;
                this.inputs.moveRight = false;
                this.inputs.jump = true;
            } else {
                // Not under any platform in the next layer, find the closest one and walk towards it
                let closestDist = Infinity;
                let targetNavX = centerX;

                for (let i = 0; i < nextLayerPlatforms.length; i++) {
                    const plat = nextLayerPlatforms[i];
                    // Target points slightly inside the platform
                    const leftEdge = plat.x + 30;
                    const rightEdge = plat.x + plat.width - 30;

                    if (Math.abs(leftEdge - centerX) < closestDist) {
                        closestDist = Math.abs(leftEdge - centerX);
                        targetNavX = leftEdge;
                    }
                    if (Math.abs(rightEdge - centerX) < closestDist) {
                        closestDist = Math.abs(rightEdge - centerX);
                        targetNavX = rightEdge;
                    }
                }

                const navDx = targetNavX - centerX;
                this.inputs.moveLeft = navDx < 0;
                this.inputs.moveRight = navDx > 0;
                this.inputs.jump = false; 
            }
        }
    }

    // General Jump Logic (Fallback if not navigating a tricky platform)
    if (!isNavigatingToPlatform && dy < -60 && distX < 120 && this.isGrounded) {
        this.inputs.jump = true;
    }

    // General Drop Down Logic (if opponent is below, and AI is on an elevated platform)
    // 부엉이도 이제 Y축을 맞추기 위해 아래로 내려가도록 예외 처리를 해제합니다.
    if (dy > 50 && this.isGrounded && (this.y + this.height) < 300) {
        this.inputs.down = true;
    }

    // ---------------------------------------------------------
    // Skill & Movement Execution Timing Error (Delay)
    // ---------------------------------------------------------
    // AI가 스킬이나 회피 기동(점프/하향점프)을 수행하기로 결심했더라도, 타이밍 오차만큼 늦게 버튼을 누르는 사람의 실수를 구현
    if (timingErrorFrames > 0) {
        if (this.inputs.attack) {
            this.inputs.attack = false;
            this.aiPlannedAttackDelay = Math.floor(Math.random() * timingErrorFrames) + 1;
        }
        if (this.inputs.special) {
            this.inputs.special = false;
            this.aiPlannedSpecialDelay = Math.floor(Math.random() * timingErrorFrames) + 1;
        }
        if (this.inputs.jump) {
            this.inputs.jump = false;
            this.aiPlannedJumpDelay = Math.floor(Math.random() * timingErrorFrames) + 1;
        }
        if (this.inputs.down) {
            this.inputs.down = false;
            this.aiPlannedDownDelay = Math.floor(Math.random() * timingErrorFrames) + 1;
        }
    }
};
