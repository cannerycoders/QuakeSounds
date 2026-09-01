#ifndef adsr_h
#define adsr_h

class ADSR
{
public:
    enum state
    {
        k_idle,
        k_attack,
        k_decay,
        k_sustain,
        k_release
    };

    ADSR()
    {
        init();
    }

    void init()
    {
        init(1, 65535, 10, 55000,
            40 * 256 * 30,  // > 15 s sustain
            1);
    }

    void init(uint16_t attackIncr, uint16_t attackTarget,
              uint16_t decayIncr, uint16_t decayTarget,
              uint32_t sustainInterval,
              uint16_t releaseIncr)
    {
        m_attackIncr = attackIncr;
        m_attackTarget = attackTarget;
        m_decayIncr = decayIncr;
        m_decayTarget = decayTarget;
        m_sustainInterval = sustainInterval;
        m_releaseIncr = releaseIncr;
        reset();
    }

    void reset()
    {
        m_state = k_idle;
        m_amp = 0;
        m_phase = 0;
        m_sustain = 0;
    }

    state getState()
    {
        return m_state;
    }

    uint16_t apply(uint16_t sample)
    {
        uint16_t result = (sample * m_amp) >> 16;

        m_phase++;
        switch(m_state)
        {
        case k_idle:
            m_state = k_attack;
            break;
        case k_attack:
            m_amp += m_attackIncr;
            if(m_amp >= m_attackTarget)
            {
                m_amp = m_attackTarget;
                m_state = k_decay;
            }
            break;
        case k_decay:
            if(m_decayIncr == 0)
                m_state = k_sustain;
            else
            {
                m_amp -= m_decayIncr;
                if(m_amp <= m_decayTarget)
                {
                    m_amp = m_decayTarget;
                    m_state = k_sustain;
                }
            }
            break;
        case k_sustain:
            if(m_sustainInterval == 0 || ++m_sustain >= m_sustainInterval)
            {
                m_state = k_release;
                m_sustain = 0;
            }
            break;
        case k_release:
            if(m_releaseIncr > 0)
            {
                if(m_amp > m_releaseIncr)
                    m_amp -= m_releaseIncr;
                else
                {
                    m_amp = 0;
                    m_state = k_idle;
                }
            }
            else
            {
                m_amp = 0;
                m_state = k_idle;
            }
            break;
        }
        return result;
    }

private:
    uint32_t m_phase, m_sustain;
    uint16_t m_attackIncr, m_attackTarget;
    uint16_t m_decayIncr, m_decayTarget;
    uint32_t m_sustainInterval; // a duration
    uint16_t m_releaseIncr; // releaseTarget is 0
    state m_state;
    uint32_t m_amp; // 15.16
};


#endif
